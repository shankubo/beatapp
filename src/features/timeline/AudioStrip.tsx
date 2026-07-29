/**
 * Bande des pistes audio sur la timeline.
 *
 * Elle manquait entierement: la timeline ne montrait que la regle, les clips et
 * les textes. Aucune piste audio n'etait donc visible, ni la musique ni le son
 * d'origine d'une video — on ne pouvait pas voir OU un son commencait, ce qui
 * rendait un son place a 4,6 s indiscernable d'un son absent.
 *
 * Une ligne par piste, et UN BLOC PAR SEGMENT sur cette ligne: une coupe audio
 * se voit donc comme la coupe d'un plan. La couleur porte le role: violet pour la
 * musique, bleu-media pour le son d'origine d'une video — la meme famille que ses
 * vignettes.
 *
 * Gestes:
 * - tap: amene la tete de lecture au debut de la piste et ouvre l'onglet Audio;
 * - glissement horizontal: deplace `track.start` (un seul point d'annulation).
 *
 * Le glissement est le VRAI interet de cette bande: caler le son d'une video sur
 * une autre image se faisait jusqu'ici a l'aveugle, par un curseur de decalage.
 */

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDrag } from '@use-gesture/react';

import { MusicIcon } from '../../components/ui/icons';
import { useProjectStore } from '../../store/useProjectStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { useUiStore } from '../../store/useUiStore';
import { CONTROLS_W, TrackControls } from './TrackControls';
import { scheduleSegments, trackDuration } from '../../domain/audioEdit';
import { videoDuration } from '../../domain/timeline';
import type { AudioTrack } from '../../domain/types';
import type { TimelineGeometry } from './useTimelineGestures';

interface AudioStripProps {
  geometry: TimelineGeometry;
  /** Temps affiche au centre de l'ecran (meme valeur que ClipStrip). */
  centerTime: number;
}

/** Hauteur d'une ligne de piste audio, en pixels. */
const LANE_H = 26;
/** Largeur minimale d'un bloc: en dessous il serait impossible a tapper. */
const MIN_BLOCK_PX = 24;

export function AudioStrip({ geometry, centerTime }: AudioStripProps) {
  const { t } = useTranslation(['editor', 'common']);

  const project = useProjectStore((state) => state.project);
  const setAudioTrackFlags = useProjectStore((state) => state.setAudioTrackFlags);
  const { pxPerSecond, viewportWidth } = geometry;

  const tracks = project.audioTracks;
  // Rien a montrer: la bande se retire plutot que d'occuper une ligne vide.
  if (tracks.length === 0) return null;

  // La colonne de tete occupe les premiers pixels: les blocs commencent apres.
  const offsetPx = CONTROLS_W + viewportWidth / 2 - centerTime * pxPerSecond;

  return (
    <div
      aria-label={t('editor:timeline.audioTrack')}
      className="relative shrink-0 overflow-hidden border-b border-ink-700 bg-ink-950"
      style={{ height: tracks.length * LANE_H }}
    >
      <div
        className="absolute inset-y-0 left-0 will-change-transform"
        style={{ transform: `translate3d(${offsetPx}px, 0, 0)` }}
      >
        {tracks.map((track, index) => (
          <AudioLane
            key={track.id}
            track={track}
            lane={index}
            pxPerSecond={pxPerSecond}
            reelDuration={videoDuration(project.videoTrack)}
            sourceDuration={project.assets[track.assetId]?.duration ?? 0}
            name={project.assets[track.assetId]?.name ?? ''}
          />
        ))}
      </div>

      {/* Une colonne de commandes par piste, empilee comme les lignes. */}
      {tracks.map((track, index) => (
        <div
          key={`${track.id}_controls`}
          className="absolute inset-x-0"
          style={{ top: index * LANE_H, height: LANE_H }}
        >
          <TrackControls
            locked={track.locked === true}
            onToggleLock={() =>
              setAudioTrackFlags(track.id, { locked: !(track.locked === true) })
            }
            // Absent vaut ACTIF pour l'audio: c'est le comportement historique.
            magnet={track.magnet !== false}
            onToggleMagnet={() =>
              setAudioTrackFlags(track.id, { magnet: track.magnet === false })
            }
            trackLabel={t('editor:timeline.trackAudioNamed', {
              name: project.assets[track.assetId]?.name ?? '',
            })}
          />
        </div>
      ))}

      {/* Aligne sur le meme point que `offsetPx`: cf. ClipStrip. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-beat-400/40"
        style={{ left: CONTROLS_W + viewportWidth / 2 }}
      />
    </div>
  );
}

/**
 * Une ligne de piste: UN BLOC PAR SEGMENT.
 *
 * C'etait le manque. La bande dessinait un seul bloc par piste, en se fiant a
 * `trackDuration` (le total): une coupe audio existait bel et bien dans les
 * donnees mais restait invisible, alors que la coupe d'un plan se voyait
 * immediatement. Les segments sont desormais dessines separement, comme les clips.
 *
 * Les positions viennent de `scheduleSegments`, LA MEME fonction que celle du
 * lecteur et du mixage d'export. Recalculer ici aurait ouvert une seconde verite:
 * la bande pourrait montrer un decoupage different de celui qu'on entend.
 */
function AudioLane({
  track,
  lane,
  pxPerSecond,
  reelDuration,
  sourceDuration,
  name,
}: {
  track: AudioTrack;
  lane: number;
  pxPerSecond: number;
  reelDuration: number;
  sourceDuration: number;
  name: string;
}) {
  const { t } = useTranslation(['editor', 'common']);

  const updateAudioTrack = useProjectStore((state) => state.updateAudioTrack);
  const setTime = usePlaybackStore((state) => state.setTime);
  const openTab = useUiStore((state) => state.openTab);

  // Position au debut du geste: sans elle, les deltas s'accumuleraient sur une
  // valeur deja modifiee et la piste filerait.
  const originStart = useRef(track.start);

  const bind = useDrag(
    ({ first, last, movement: [mx], tap, event }) => {
      if (tap) {
        setTime(track.start);
        openTab('audio');
        return;
      }

      if (first) {
        useProjectStore.temporal.getState().pause();
        originStart.current = track.start;
      }
      event.stopPropagation();

      const next = Math.max(0, originStart.current + mx / pxPerSecond);
      if (!last) {
        updateAudioTrack(track.id, { start: next });
        return;
      }

      // Cloture: on repose la valeur d'origine historique en pause, puis on
      // rejoue l'etat final avec l'historique actif. Le geste entier devient
      // ainsi un unique point d'annulation.
      updateAudioTrack(track.id, { start: originStart.current });
      useProjectStore.temporal.getState().resume();
      updateAudioTrack(track.id, { start: next });
    },
    { filterTaps: true, pointer: { touch: true }, axis: 'x' },
  );

  /**
   * Segments places sur la timeline.
   *
   * `until: Infinity`: on veut voir TOUT le decoupage, y compris ce qui depasse
   * la fin du reel — c'est justement l'information qui manquait pour comprendre
   * qu'un son ne s'entend pas.
   */
  const scheduled = scheduleSegments(track, {
    from: 0,
    until: Number.POSITIVE_INFINITY,
    sourceDuration: sourceDuration > 0 ? sourceDuration : trackDuration(track),
  });

  // Le son d'origine porte la couleur des medias visuels: il vient d'une video,
  // et cette parente doit se lire d'un coup d'oeil.
  const isOriginal = track.role === 'original';

  /**
   * Une piste qui depasse la fin du reel est signalee.
   *
   * C'est le piege exact du son d'origine: cale sur son plan, il peut commencer
   * si tard que rien ne s'entend. Le liseré vermillon le rend visible au lieu de
   * laisser croire a une panne.
   */
  const startsAfterEnd = track.start >= reelDuration;

  const label = isOriginal
    ? t('editor:originalAudio.trackOf', { name })
    : t('editor:audio.music');

  const tone = startsAfterEnd
    ? 'border-danger-500 bg-danger-500/15 text-danger-500'
    : isOriginal
      ? 'border-media-400/50 bg-media-400/15 text-media-400'
      : 'border-audio-400/50 bg-audio-400/15 text-audio-400';

  return (
    <>
      {scheduled.map((segment, index) => {
        const width = Math.max(MIN_BLOCK_PX, segment.duration * pxPerSecond);
        const left = segment.at * pxPerSecond;
        // Un seul segment: la piste n'est pas decoupee, on n'annonce pas de
        // numero de passage qui n'aurait aucun sens.
        const single = scheduled.length === 1;

        return (
          <div
            key={`${track.id}_${index}`}
            {...bind()}
            role="button"
            tabIndex={0}
            aria-label={
              single
                ? label
                : `${label} — ${t('editor:audio.segment', { index: index + 1 })}`
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                setTime(segment.at);
                openTab('audio');
              }
            }}
            className={[
              'absolute flex touch-none select-none items-center gap-1 overflow-hidden',
              'border px-1.5 text-[10px] font-medium leading-none',
              // Les coins arrondis marquent les EXTREMITES de la piste: un
              // segment du milieu garde ses bords droits, si bien qu'une coupe se
              // lit comme une coupe et non comme deux pistes distinctes.
              index === 0 ? 'rounded-l' : '',
              index === scheduled.length - 1 ? 'rounded-r' : '',
              track.muted || track.gain <= 0 ? 'opacity-45' : '',
              tone,
            ].join(' ')}
            style={{
              left,
              width,
              top: lane * LANE_H + 3,
              height: LANE_H - 6,
            }}
          >
            {/* L'icone n'apparait que sur le premier morceau: la repeter sur
                chaque segment mangerait la place utile des petits blocs. */}
            {index === 0 && (
              <span className="shrink-0 [&>svg]:size-2.5">
                <MusicIcon />
              </span>
            )}
            <span className="truncate">
              {isOriginal ? t('editor:originalAudio.track') : t('editor:audio.music')}
            </span>
          </div>
        );
      })}
    </>
  );
}
