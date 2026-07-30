/**
 * Bande de clips: la surface d'edition principale.
 *
 * Le playhead est fixe au centre; les clips defilent dessous. Chaque clip est
 * positionne en `translate3d` uniquement, jamais par `left`: pendant un
 * glissement, un changement de `left` declencherait un reflow par frame.
 */

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDrag } from '@use-gesture/react';

import { PlusIcon, ScissorsIcon } from '../../components/ui/icons';

import { useProjectStore } from '../../store/useProjectStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { useUiStore } from '../../store/useUiStore';
import { useMedia } from '../preview/MediaProvider';
import { musicTrack } from '../../domain/project';
import { defaultTolerance, snapTime, timelineGrid } from '../../domain/snapping';
import { MIN_CLIP_DURATION, type Clip } from '../../domain/types';
import { useSnapHaptics, type TimelineGeometry } from './useTimelineGestures';
import { useThumbnail } from '../import/useThumbnail';
import { CONTROLS_W, TrackControls } from './TrackControls';
import { formatDuration } from '../../lib/format';
import { clamp } from '../../lib/math';

interface ClipStripProps {
  geometry: TimelineGeometry;
  /** Temps affiche au centre de l'ecran. */
  centerTime: number;
}

/** Distance verticale au-dela de laquelle un glissement supprime le clip. */
const DELETE_THRESHOLD_PX = 60;
/** Duree d'appui avant de passer en mode reordonnancement. */
const LONG_PRESS_MS = 250;

export function ClipStrip({ geometry, centerTime }: ClipStripProps) {
  const { t } = useTranslation(['editor', 'common']);

  const project = useProjectStore((state) => state.project);
  const selectedClipId = usePlaybackStore((state) => state.selectedClipId);
  const setTrackLocked = useProjectStore((state) => state.setTrackLocked);
  const setVideoTrackMagnet = useProjectStore((state) => state.setVideoTrackMagnet);

  const { pxPerSecond, viewportWidth } = geometry;
  const clips = project.videoTrack.clips;

  // Decalage tel que `centerTime` tombe au milieu de l'ecran.
  // La colonne de tete occupe les premiers pixels: les clips commencent apres.
  const offsetPx = CONTROLS_W + viewportWidth / 2 - centerTime * pxPerSecond;

  return (
    <div className="relative h-strip shrink-0 overflow-hidden border-b border-ink-700">
      <div
        className="absolute inset-y-0 left-0 flex items-center will-change-transform"
        style={{ transform: `translate3d(${offsetPx}px, 0, 0)` }}
      >
        {clips.map((clip, index) => (
          <ClipItem
            key={clip.id}
            clip={clip}
            index={index}
            geometry={geometry}
            selected={clip.id === selectedClipId}
          />
        ))}

        <AddClipButton />
      </div>

      {/* Tete de lecture: fixe au centre, au-dessus des clips. */}
      {/*
        Cadenas et aimant de la piste image.

        L'aimant ne cree pas de trou — la piste reste contigue par construction —
        il decide si le SON et le TEXTE suivent l'image quand on supprime un plan.
        Actif, tout reste cale; inactif, l'audio garde sa position absolue.
      */}
      <TrackControls
        locked={project.videoTrack.locked === true}
        onToggleLock={() =>
          setTrackLocked('video', !(project.videoTrack.locked === true))
        }
        magnet={project.videoTrack.magnet !== false}
        onToggleMagnet={() =>
          setVideoTrackMagnet(project.videoTrack.magnet === false)
        }
        trackLabel={t('editor:timeline.trackImage')}
        magnetFollowsOthers
      />

      {/*
        Le trait tombe exactement sur `CONTROLS_W + viewportWidth / 2`, le point
        que `offsetPx` amene sous `centerTime`.

        Un simple `left-1/2` le placait 44 px a gauche du temps reellement
        pointe: on coupait donc a cote de ce que le trait montrait (mesure a
        t=0: bord du premier clip a 1093 px, trait a 1048 px).
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-beat-400"
        style={{ left: CONTROLS_W + viewportWidth / 2 }}
      >
        {/*
          Ciseaux en tete du trait, a la place de la simple boule.

          L'appui long sur le montage sort l'outil de coupe (voir
          `TimelineScroller`), mais RIEN ne le disait: un geste cache n'existe
          pas pour qui ne le connait pas deja. Le pictogramme est pose la ou la
          coupe se produira — sur le trait — donc il annonce l'action ET son
          point d'application d'un seul coup d'oeil.

          Decoratif: il ne recoit pas le geste, c'est la bande entiere qui
          l'ecoute. Un bouton de 12 px serait de toute facon intouchable.
        */}
        <span
          aria-hidden="true"
          className="absolute -top-0.5 left-1/2 flex size-3.5 -translate-x-1/2 items-center justify-center rounded-full bg-beat-400 text-ink-950 [&>svg]:size-2.5"
        >
          <ScissorsIcon />
        </span>
      </div>

      {/* L'invite se pose SOUS le bouton d'ajout, qui occupe le centre: centree
          sur toute la hauteur, elle passait derriere lui. */}
      {clips.length === 0 && (
        <p className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-[11px] text-ink-400">
          {t('editor:media.emptyHint')}
        </p>
      )}
    </div>
  );
}

interface ClipItemProps {
  clip: Clip;
  index: number;
  geometry: TimelineGeometry;
  selected: boolean;
}

function ClipItem({ clip, index, geometry, selected }: ClipItemProps) {
  const { t, i18n } = useTranslation(['editor', 'common']);
  const { pxPerSecond } = geometry;

  const project = useProjectStore((state) => state.project);
  const trimStart = useProjectStore((state) => state.trimStart);
  const trimEnd = useProjectStore((state) => state.trimEnd);
  const moveClip = useProjectStore((state) => state.moveClip);
  const removeClip = useProjectStore((state) => state.removeClip);
  const selectClip = usePlaybackStore((state) => state.selectClip);
  const setTime = usePlaybackStore((state) => state.setTime);
  const openTab = useUiStore((state) => state.openTab);
  const pushToast = useUiStore((state) => state.pushToast);

  const { blobs } = useMedia();
  const haptics = useSnapHaptics();

  /** Aimantation sur la grille rythmique, si activee. */
  const snapGrid = useMemo(() => {
    if (!project.snapping.enabled || !project.beatMap) return null;
    return {
      grid: timelineGrid(project.beatMap, musicTrack(project), project.snapping.division),
      tolerance: defaultTolerance(project.beatMap, project.snapping.division),
    };
    // `project` couvre les champs lus dans le corps (snapping, beatMap,
    // pistes audio): les lister en plus serait redondant.
  }, [project]);

  const snapBoundary = (time: number): { time: number; snapped: boolean } => {
    if (!snapGrid) return { time, snapped: false };
    const result = snapTime(snapGrid.grid, time, snapGrid.tolerance);
    return { time: result, snapped: result !== time };
  };

  // --- Etat transitoire du geste: jamais dans React pendant le mouvement.
  const [visualOffset, setVisualOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<'none' | 'reorder' | 'trimStart' | 'trimEnd'>(
    'none',
  );
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Largeur du bloc, avec un plancher pour qu'il reste saisissable.
   *
   * Le plancher etait a 18 px, ce qui gelait le dezoom: sur un montage de plans
   * courts (~0,13 s), 28 blocs sur 29 y touchaient des 67 % et la bande entiere
   * restait figee a 560 px pendant que le pourcentage continuait de descendre —
   * le bouton « − » paraissait donc mort.
   *
   * A 6 px le bloc reste visible et distinguable, et le dezoom redevient utile
   * pour embrasser tout un montage d'un coup d'oeil. La cible tactile n'est pas
   * perdue pour autant: on selectionne un plan en tapant, et l'aimantation de la
   * tete de lecture reste le moyen precis de viser.
   */
  const width = Math.max(6, clip.duration * pxPerSecond);
  // `kind` est passe explicitement: les blobs OPFS ont `type = ""` et seraient
  // faussement traites comme des images sans ce parametre.
  const assetKind = project.assets[clip.assetId]?.kind;
  const { url: thumbnail } = useThumbnail(blobs.get(clip.assetId), assetKind);

  /**
   * Selectionne le clip et amene la tete de lecture dessus.
   *
   * Le deplacement est indissociable de la selection: les panneaux Modifier et
   * Effets agissent sur le clip SELECTIONNE, tandis que l'apercu montre le clip
   * situe a la position de lecture. Si les deux divergent, on regle un filtre en
   * regardant une autre image, et les reglages paraissent sans effet.
   *
   * Le petit decalage evite de tomber pile sur la frontiere avec le clip
   * precedent, ou une transition pourrait encore afficher l'image sortante.
   */
  const selectAndSeek = () => {
    selectClip(clip.id);
    setTime(clip.start + Math.min(0.05, clip.duration / 2));
  };

  // --- Glissement du corps du clip: reordonnancement ou suppression.
  const bindBody = useDrag(
    ({ first, last, movement: [mx, my], tap }) => {
      if (tap) {
        selectAndSeek();
        return;
      }

      if (first) {
        // L'appui long fait basculer en reordonnancement; un glissement
        // immediat est laisse au scrub du conteneur parent.
        longPressTimer.current = setTimeout(() => setDragging('reorder'), LONG_PRESS_MS);
      }

      if (dragging === 'none') {
        // Geste vertical franc: suppression, sans attendre l'appui long.
        if (Math.abs(my) > 24 && Math.abs(my) > Math.abs(mx)) {
          setDragging('reorder');
        } else if (!last) {
          return;
        }
      }

      if (last) {
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        setVisualOffset({ x: 0, y: 0 });
        setDragging('none');

        if (-my > DELETE_THRESHOLD_PX) {
          const removed = clip;
          const removedIndex = index;
          removeClip(clip.id);
          pushToast({
            i18nKey: 'editor:timeline.clipDeleted',
            tone: 'info',
            undo: () => {
              // On reinsere a sa place: annuler doit restaurer l'ordre exact.
              useProjectStore.getState().addClip(
                project.assets[removed.assetId]!,
                removedIndex,
              );
            },
          });
          return;
        }

        // Reordonnancement: on convertit le deplacement en nombre de positions.
        const shift = Math.round(mx / Math.max(width, 1));
        if (shift !== 0) moveClip(index, index + shift);
        return;
      }

      setVisualOffset({ x: mx, y: Math.min(0, my) });
    },
    { filterTaps: true, pointer: { touch: true } },
  );

  // --- Poignees de trim.
  // Deux appels de hook distincts et inconditionnels: appeler `useDragTrim`
  // depuis une fonction parametree violerait les regles des hooks.
  const bindTrimStart = useDragTrim({
    edge: 'start',
    clip,
    pxPerSecond,
    onCommit: (delta) => trimStart(clip.id, delta),
    snapBoundary,
    haptics,
    setDragging,
  });
  const bindTrimEnd = useDragTrim({
    edge: 'end',
    clip,
    pxPerSecond,
    onCommit: (delta) => trimEnd(clip.id, delta),
    snapBoundary,
    haptics,
    setDragging,
  });

  const deleting = -visualOffset.y > DELETE_THRESHOLD_PX;

  return (
    <div
      className="relative h-full shrink-0 px-px py-2"
      style={{ width }}
    >
      <div
        {...bindBody()}
        onDoubleClick={() => {
          selectAndSeek();
          // Le double-tap ouvre les reglages du plan: c'est le geste "je veux
          // modifier celui-la".
          openTab('edit');
        }}
        role="button"
        tabIndex={0}
        aria-label={t('editor:timeline.clip', { index: index + 1 })}
        className={[
          'relative h-full touch-none overflow-hidden rounded-lg border transition-colors',
          selected ? 'border-beat-400' : 'border-ink-600',
          deleting ? 'border-danger-500 opacity-50' : '',
          dragging === 'reorder' ? 'z-10 scale-105 shadow-xl' : '',
        ].join(' ')}
        style={{
          transform: `translate3d(${visualOffset.x}px, ${visualOffset.y}px, 0)`,
          willChange: dragging === 'none' ? undefined : 'transform',
        }}
      >
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            draggable={false}
            className="size-full object-cover"
          />
        ) : (
          <div className="size-full bg-ink-800" />
        )}

        {/* Duree du clip: le seul texte affiche, et il est utile. */}
        <span className="tnum absolute bottom-0.5 left-1 text-[10px] font-medium text-ink-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
          {formatDuration(clip.duration, i18n.language)}
        </span>

        {/* Un clip cale sur le rythme porte un liseré chartreuse: l'information
            "cette duree suit le beat" doit etre lisible d'un coup d'oeil. */}
        {clip.beatLocked && (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-0.5 bg-beat-400"
          />
        )}
      </div>

      {selected && (
        <>
          <TrimHandle side="start" label={t('editor:timeline.trimStart')} bind={bindTrimStart} />
          <TrimHandle side="end" label={t('editor:timeline.trimEnd')} bind={bindTrimEnd} />
        </>
      )}
    </div>
  );
}

/**
 * Poignee de trim: 6 px visibles, mais 44 px de cible tactile grace au
 * rembourrage transparent. Sans cela, le trim est inutilisable au pouce.
 */
function TrimHandle({
  side,
  label,
  bind,
}: {
  side: 'start' | 'end';
  label: string;
  bind: ReturnType<typeof useDrag>;
}) {
  return (
    <div
      {...bind()}
      role="button"
      aria-label={label}
      tabIndex={-1}
      className={[
        'absolute inset-y-0 flex w-11 touch-none items-center justify-center',
        side === 'start' ? '-left-5' : '-right-5',
      ].join(' ')}
    >
      <span className="h-8 w-1.5 rounded-full bg-beat-400" />
    </div>
  );
}

/** Glissement d'une poignee de trim, avec aimantation et retour haptique. */
function useDragTrim({
  edge,
  clip,
  pxPerSecond,
  onCommit,
  snapBoundary,
  haptics,
  setDragging,
}: {
  edge: 'start' | 'end';
  clip: Clip;
  pxPerSecond: number;
  onCommit: (deltaSeconds: number) => void;
  snapBoundary: (time: number) => { time: number; snapped: boolean };
  haptics: (time: number | null) => void;
  setDragging: (state: 'none' | 'reorder' | 'trimStart' | 'trimEnd') => void;
}) {
  return useDrag(
    ({ first, last, movement: [mx] }) => {
      if (first) setDragging(edge === 'start' ? 'trimStart' : 'trimEnd');

      const deltaSeconds = mx / pxPerSecond;
      // On aimante la FRONTIERE resultante, pas le deplacement: c'est la coupe
      // qui doit tomber sur le beat.
      const boundary =
        edge === 'start' ? clip.start + deltaSeconds : clip.start + clip.duration + deltaSeconds;
      const { time: snappedBoundary, snapped } = snapBoundary(boundary);

      haptics(snapped ? snappedBoundary : null);

      if (last) {
        setDragging('none');
        haptics(null);

        const finalDelta =
          edge === 'start'
            ? snappedBoundary - clip.start
            : snappedBoundary - (clip.start + clip.duration);

        // On borne pour ne jamais produire un clip plus court qu'une frame.
        const bounded =
          edge === 'start'
            ? clamp(finalDelta, -clip.start, clip.duration - MIN_CLIP_DURATION)
            : Math.max(finalDelta, MIN_CLIP_DURATION - clip.duration);

        if (Math.abs(bounded) > 1e-6) onCommit(bounded);
      }
    },
    { axis: 'x', filterTaps: true, pointer: { touch: true } },
  );
}

function AddClipButton() {
  const { t } = useTranslation('editor');
  const openTab = useUiStore((state) => state.openTab);

  return (
    <button
      type="button"
      /*
        `pointerdown` et non `click`: le scrub de la timeline s'empare du
        pointeur avant que le clic de synthese n'arrive, et le bouton restait
        inerte au clavier-souris. Cf. `TrackControls` pour la meme correction.
      */
      onPointerDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
        openTab('media');
      }}
      aria-label={t('timeline.addClip')}
      className="my-2 ml-1 flex h-[calc(100%-1rem)] w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-ink-600 text-ink-400 active:bg-ink-850"
    >
      <PlusIcon />
    </button>
  );
}


