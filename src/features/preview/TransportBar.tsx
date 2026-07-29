import { useTranslation } from 'react-i18next';
import { useSyncExternalStore } from 'react';

import { IconButton } from '../../components/ui/IconButton';
import {
  PauseIcon,
  PlayIcon,
  RedoIcon,
  SkipBackIcon,
  SkipForwardIcon,
  UndoIcon,
} from '../../components/ui/icons';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { useProjectStore } from '../../store/useProjectStore';
import { clipIndexAt, videoDuration } from '../../domain/timeline';
import { formatRate, formatTimecode } from '../../lib/format';

export function TransportBar({ translucent = false }: { translucent?: boolean } = {}) {
  const { t, i18n } = useTranslation(['editor', 'common']);

  const project = useProjectStore((state) => state.project);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const setPlaying = usePlaybackStore((state) => state.setPlaying);
  const setTime = usePlaybackStore((state) => state.setTime);

  const duration = videoDuration(project.videoTrack);
  const hasClips = project.videoTrack.clips.length > 0;

  // L'historique d'annulation vit hors du store React: on s'y abonne
  // explicitement pour que les boutons refletent son etat reel.
  const history = useProjectStore.temporal;
  const historyState = useSyncExternalStore(
    (listener) => history.subscribe(listener),
    () => history.getState(),
  );

  const jumpToClipBoundary = (direction: -1 | 1) => {
    const time = usePlaybackStore.getState().time;
    const clips = project.videoTrack.clips;
    const index = clipIndexAt(project.videoTrack, time);
    if (index < 0) return;

    const current = clips[index]!;
    if (direction === -1) {
      // Retour au debut du clip courant, sauf si on y est deja (a une frame
      // pres): dans ce cas on remonte au clip precedent.
      const atStart = time - current.start < 1 / project.frame.fps;
      const target = atStart ? clips[index - 1] : current;
      setTime(target ? target.start : 0);
    } else {
      const next = clips[index + 1];
      setTime(next ? next.start : duration);
    }
  };

  return (
    /*
      Fond propre: sans lui, la barre se confondait avec l'apercu au-dessus et
      les commandes semblaient flotter sur l'image.

      En mode compact la barre passe SUR l'image, ou ce risque est maximal. D'ou
      un voile opaque a 80 % plus un flou d'arriere-plan, et non une simple
      transparence: le texte et les icones doivent garder leur contraste au-dessus
      de n'importe quelle photo, y compris un ciel blanc.
    */
    <div
      className={[
        'flex h-transport shrink-0 items-center justify-between px-1',
        translucent
          ? 'border-t border-ink-700/50 bg-ink-950/80 backdrop-blur-sm'
          : 'border-t border-ink-700 bg-ink-900',
      ].join(' ')}
    >
      <div className="flex items-center">
        <IconButton
          label={t('common:action.undo')}
          onClick={() => history.getState().undo()}
          disabled={historyState.pastStates.length === 0}
          size="sm"
        >
          <UndoIcon />
        </IconButton>
        <IconButton
          label={t('common:action.redo')}
          onClick={() => history.getState().redo()}
          disabled={historyState.futureStates.length === 0}
          size="sm"
        >
          <RedoIcon />
        </IconButton>
      </div>

      <div className="flex items-center gap-1">
        <IconButton
          label={t('editor:transport.previousClip')}
          onClick={() => jumpToClipBoundary(-1)}
          disabled={!hasClips}
          size="sm"
        >
          <SkipBackIcon />
        </IconButton>

        <IconButton
          label={isPlaying ? t('editor:transport.pause') : t('editor:transport.play')}
          onClick={() => setPlaying(!isPlaying)}
          disabled={!hasClips}
          tone="beat"
          size="lg"
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </IconButton>

        <IconButton
          label={t('editor:transport.nextClip')}
          onClick={() => jumpToClipBoundary(1)}
          disabled={!hasClips}
          size="sm"
        >
          <SkipForwardIcon />
        </IconButton>
      </div>

      <div className="flex items-center gap-1">
        <RateButton />
        <Timecode duration={duration} locale={i18n.language} />
      </div>
    </div>
  );
}

/**
 * Vitesse d'apercu, en cycle.
 *
 * Un bouton qui defile plutot qu'un curseur: sur 390 px la barre de transport n'a
 * pas la place d'un curseur utilisable au doigt, et quatre valeurs nommees
 * couvrent tout le besoin. Le ralenti sert a caler un texte ou une image au
 * dixieme de seconde; l'accelere a verifier l'allure generale.
 *
 * La vitesse ne touche PAS le montage: l'export garde son horloge deterministe.
 * Un liseré chartreuse signale l'etat non neutre, pour qu'on n'oublie pas qu'on
 * regarde au ralenti.
 */
const RATE_STEPS = [1, 0.5, 0.25, 2] as const;

function RateButton() {
  const { t, i18n } = useTranslation(['editor', 'common']);
  const rate = usePlaybackStore((state) => state.rate);
  const setRate = usePlaybackStore((state) => state.setRate);

  const next = () => {
    const index = RATE_STEPS.indexOf(rate as (typeof RATE_STEPS)[number]);
    // Une valeur hors cycle (bornage) repart au debut.
    setRate(RATE_STEPS[(index + 1) % RATE_STEPS.length] ?? 1);
  };

  return (
    <button
      type="button"
      onClick={next}
      aria-label={t('editor:transport.speed')}
      className={[
        'tnum min-h-9 rounded-lg border px-2 text-[11px] font-semibold',
        rate === 1
          ? 'border-ink-600 text-ink-300 active:bg-ink-800'
          : 'border-beat-400 text-beat-400',
      ].join(' ')}
    >
      {formatRate(rate, i18n.language)}
    </button>
  );
}

/**
 * Compteur de temps.
 *
 * Abonnement direct au store plutot que `useStore`: le temps change 60 fois par
 * seconde en lecture, et re-rendre l'arbre parent a cette cadence couterait
 * bien plus cher que ce seul noeud de texte.
 */
function Timecode({ duration, locale }: { duration: number; locale: string }) {
  const time = useSyncExternalStore(
    (listener) => usePlaybackStore.subscribe(listener),
    () => usePlaybackStore.getState().time,
  );

  return (
    <div className="tnum pr-2 text-right text-[11px] leading-tight text-ink-400">
      <div className="text-ink-200">{formatTimecode(time, locale)}</div>
      <div>{formatTimecode(duration, locale)}</div>
    </div>
  );
}
