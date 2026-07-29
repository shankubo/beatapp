/**
 * Piste des textes sur la timeline.
 *
 * Elle montre DEUX natures de texte, parce que l'utilisateur en voit deux a
 * l'ecran et ne comprendrait pas qu'une seule figure ici:
 *
 * - les **incrustations libres** (`project.overlays`), editables une par une;
 * - les **lignes de paroles** (`project.lyrics.lines`), qui partagent un style
 *   et se restylent en bloc.
 *
 * Les deux sont converties en `TextOverlay` avant affichage — `lyricOverlays()`
 * fait exactement cela pour le compositeur. On reutilise la meme conversion:
 * une seule voie de verite, aucun cas particulier ajoute a cette piste.
 *
 * En revanche l'ECRITURE differe et ne peut pas etre unifiee: une incrustation
 * passe par `updateText`, une ligne de paroles par `updateLyricLine`. C'est
 * pourquoi chaque bloc porte sa `kind` et son propre rappel de mise a jour.
 *
 * Chaque bloc est positionne par (start * pxPerSecond) et large de
 * (duration * pxPerSecond).
 *
 * Gestes supportes sur le corps du bloc:
 * - Tap simple: amene la tete de lecture au centre + ouvre Texte.
 * - Glissement horizontal: deplace `start` (un seul point d'annulation).
 * - Appui long (600 ms): ouvre le dialogue de duree (fallback pour petits blocs).
 *
 * Geste sur la poignee droite (ResizeHandle):
 * - Glissement horizontal: modifie `duration` en temps reel.
 *   La poignee stoppe la propagation pour ne pas activer le deplacement du bloc.
 *
 * Contrairement a la ClipStrip (clips contigus), les textes peuvent se
 * chevaucher ou laisser des vides: ils sont positionnes en absolu.
 */

import { useMemo, useState, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useDrag } from '@use-gesture/react';

import { Slider } from '../../components/ui/Slider';
import { MusicIcon, TextIcon } from '../../components/ui/icons';
import { useProjectStore } from '../../store/useProjectStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { useUiStore } from '../../store/useUiStore';
import { lyricOverlays } from '../../domain/lyrics';
import type { TextOverlay } from '../../domain/types';
import { CONTROLS_W, TrackControls } from './TrackControls';
import type { TimelineGeometry } from './useTimelineGestures';

interface TextStripProps {
  geometry: TimelineGeometry;
  /** Temps affiche au centre de l'ecran (meme valeur que ClipStrip). */
  centerTime: number;
}

/**
 * Nature d'un bloc.
 *
 * Portee explicitement plutot que devinee: elle determine QUELLE action du store
 * ecrit la modification, et les deux ne sont pas interchangeables.
 */
type TextKind = 'overlay' | 'lyric';

/** Un texte a afficher dans la piste, quelle que soit son origine. */
interface StripItem {
  overlay: TextOverlay;
  kind: TextKind;
}

/** Largeur minimale d'un bloc: en dessous il serait impossible a tapper. */
const MIN_BLOCK_PX = 28;
/** Largeur au-dela de laquelle on affiche le contenu textuel. */
const TEXT_THRESHOLD_PX = 52;
/** Largeur de la poignee de redimensionnement, en pixels. */
const HANDLE_PX = 10;
/** Hauteur d'une ligne de la piste texte, en pixels. */
const LANE_H = 30;

/**
 * Attribue a chaque incrustation un numero de ligne (0-base) pour eviter
 * que des incrustations chevauchant la meme periode se superposent visuellement.
 * Algorithme greedy trie par heure de debut.
 */
function assignLanes(items: readonly StripItem[]): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.overlay.start - b.overlay.start);
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();

  for (const { overlay } of sorted) {
    const end = overlay.start + overlay.duration;
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= overlay.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    lanes.set(overlay.id, lane);
  }

  return lanes;
}

export function TextStrip({ geometry, centerTime }: TextStripProps) {
  const { t } = useTranslation(['editor', 'common']);

  const overlays = useProjectStore((state) => state.project.overlays);
  const lyrics = useProjectStore((state) => state.project.lyrics);
  const textTrack = useProjectStore((state) => state.project.textTrack);
  const setTrackLocked = useProjectStore((state) => state.setTrackLocked);
  const setTextTrackMagnet = useProjectStore((state) => state.setTextTrackMagnet);

  const selectedOverlayId = useSyncExternalStore(
    (listener) => usePlaybackStore.subscribe(listener),
    () => usePlaybackStore.getState().selectedOverlayId,
  );

  const selectOverlay = usePlaybackStore((state) => state.selectOverlay);
  const setTime = usePlaybackStore((state) => state.setTime);
  const openTab = useUiStore((state) => state.openTab);

  const { pxPerSecond, viewportWidth } = geometry;

  /**
   * Les deux natures de texte, reunies.
   *
   * Les paroles passent par `lyricOverlays()`, la MEME conversion que celle du
   * compositeur: ce que montre la piste est donc, par construction, ce qui sera
   * dessine. Les recalculer ici aurait ouvert une seconde verite.
   */
  const items: StripItem[] = useMemo(() => {
    const free: StripItem[] = overlays.map((overlay) => ({ overlay, kind: 'overlay' }));
    const sung: StripItem[] = lyrics
      ? lyricOverlays(lyrics).map((overlay) => ({ overlay, kind: 'lyric' }))
      : [];
    return [...free, ...sung];
  }, [overlays, lyrics]);

  // Rien a montrer: la piste se retire plutot que d'occuper une bande vide.
  if (items.length === 0) return null;

  // La colonne de tete occupe les premiers pixels: les blocs commencent apres.
  const offsetPx = CONTROLS_W + viewportWidth / 2 - centerTime * pxPerSecond;

  // Repartir les textes sur des lignes pour les chevauchements temporels.
  const lanes = assignLanes(items);
  const laneMax = Math.max(0, ...[...lanes.values()]);
  const numLanes = laneMax + 1;
  const stripHeight = numLanes * LANE_H;

  return (
    <div
      aria-label={t('editor:timeline.textTrack')}
      className="relative shrink-0 overflow-hidden border-b border-ink-700 bg-ink-950"
      style={{ height: stripHeight }}
    >
      <div
        className="absolute inset-y-0 left-0 will-change-transform"
        style={{ transform: `translate3d(${offsetPx}px, 0, 0)` }}
      >
        {items.map((item, index) => (
          <OverlayBlock
            key={item.overlay.id}
            overlay={item.overlay}
            kind={item.kind}
            pxPerSecond={pxPerSecond}
            // Une ligne de paroles n'est jamais « selectionnee »: la selection
            // porte sur les incrustations libres.
            selected={item.kind === 'overlay' && item.overlay.id === selectedOverlayId}
            label={
              item.kind === 'lyric'
                ? t('editor:timeline.lyricLine', { index: index + 1 })
                : t('editor:timeline.textOverlay', { index: index + 1 })
            }
            lane={lanes.get(item.overlay.id) ?? 0}
            onTap={() => {
              // Selectionner une ligne de paroles n'aurait aucun sens: elle
              // n'existe pas dans `overlays`, et `selectOverlay` ne trouverait
              // rien. On se contente d'amener la lecture dessus.
              if (item.kind === 'overlay') selectOverlay(item.overlay.id);
              setTime(item.overlay.start + item.overlay.duration / 2);
              openTab('text');
            }}
          />
        ))}
      </div>

      <TrackControls
        locked={textTrack?.locked === true}
        onToggleLock={() => setTrackLocked('text', !(textTrack?.locked === true))}
        // INACTIF par defaut pour le texte, a l'inverse de l'audio: un texte est
        // pose a un instant choisi, recoller deplacerait un calage manuel.
        magnet={textTrack?.magnet === true}
        onToggleMagnet={() => setTextTrackMagnet(!(textTrack?.magnet === true))}
        trackLabel={t('editor:timeline.trackTextName')}
      />

      {/* Aligne sur le meme point que `offsetPx`: cf. ClipStrip. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-beat-400/40"
        style={{ left: CONTROLS_W + viewportWidth / 2 }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sous-composant: un bloc d'incrustation deplacable + redimensionnable
// ---------------------------------------------------------------------------

interface OverlayBlockProps {
  overlay: TextOverlay;
  kind: TextKind;
  pxPerSecond: number;
  selected: boolean;
  label: string;
  lane: number;
  onTap: () => void;
}

/**
 * Bloc representant une incrustation texte dans la piste.
 *
 * Structure:
 *   <div outer (drag deplace start)>
 *     <div content (overflow-hidden, flex)>
 *     <ResizeHandle (drag modifie duration)>
 *   </div>
 *
 * Le dialogue de duree (fallback pour les petits blocs) est rendu via
 * createPortal directement depuis ce composant -- le portal cible document.body
 * quelle que soit la position dans l'arbre React, donc l'overflow-hidden et le
 * translate3d parents n'affectent pas son positionnement fixed.
 */
function OverlayBlock({
  overlay,
  kind,
  pxPerSecond,
  selected,
  label,
  lane,
  onTap,
}: OverlayBlockProps) {
  const updateText = useProjectStore((state) => state.updateText);
  const updateLyricLine = useProjectStore((state) => state.updateLyricLine);

  /**
   * Ecriture d'un deplacement ou d'une duree, vers la bonne action.
   *
   * Une ligne de paroles n'est PAS une incrustation: elle vit dans
   * `lyrics.lines` et `updateText` ne la trouverait pas. Router ici plutot que
   * dans chaque geste evite d'oublier le cas dans l'un des trois.
   */
  const write = (patch: { start?: number; duration?: number }) => {
    if (kind === 'lyric') updateLyricLine(overlay.id, patch);
    else updateText(overlay.id, patch);
  };

  // Dialog de duree (fallback pour les blocs trop petits pour la poignee).
  const [showDurationDialog, setShowDurationDialog] = useState(false);

  const openDurationDialog = () => {
    useProjectStore.temporal.getState().pause();
    setShowDurationDialog(true);
  };

  const closeDurationDialog = () => {
    setShowDurationDialog(false);
    useProjectStore.temporal.getState().resume();
  };

  const originStart = useRef<number>(overlay.start);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartX = useRef(0);
  const pressStartY = useRef(0);
  const lastTapTime = useRef(0);
  const DOUBLE_TAP_MS = 350;

  const bind = useDrag(
    ({ first, last, movement: [mx], tap, event }) => {
      if (tap) {
        const now = Date.now();
        // Double-tap: rien de special ici, simple ouverture du panneau.
        lastTapTime.current = now - lastTapTime.current < DOUBLE_TAP_MS ? 0 : now;
        onTap();
        return;
      }

      if (first) {
        useProjectStore.temporal.getState().pause();
        originStart.current = overlay.start;
      }
      event.stopPropagation();

      const newStart = Math.max(0, originStart.current + mx / pxPerSecond);
      if (!last) {
        write({ start: newStart });
        return;
      }
      const settled = newStart;
      write({ start: originStart.current });
      useProjectStore.temporal.getState().resume();
      write({ start: settled });
    },
    { filterTaps: true, pointer: { touch: true }, axis: 'x' },
  );

  const width = Math.max(MIN_BLOCK_PX, overlay.duration * pxPerSecond);
  const left = overlay.start * pxPerSecond;
  // Position verticale en fonction de la ligne attribuee.
  const blockTop = lane * LANE_H + 3;
  const blockHeight = LANE_H - 6;
  const dragProps = bind();

  return (
    <>
      <div
        {...dragProps}
        role="button"
        tabIndex={0}
        aria-label={label}
        className={[
          'absolute rounded border touch-none select-none',
          'text-[10px] font-medium leading-none transition-colors',
          // Les paroles portent la couleur de l'AUDIO, dont elles proviennent;
          // les incrustations libres gardent l'ambre du texte. Sans cette
          // distinction, deux natures qui s'editent differemment se
          // ressembleraient trait pour trait.
          kind === 'lyric'
            ? 'border-audio-400/50 bg-audio-400/15 text-audio-400'
            : selected
              ? 'border-overlay-400 bg-overlay-400/30 text-overlay-300'
              : 'border-overlay-400/50 bg-overlay-400/15 text-overlay-400',
        ].join(' ')}
        style={{ left, width, top: blockTop, height: blockHeight }}
        onPointerDown={(e) => {
          pressStartX.current = e.clientX;
          pressStartY.current = e.clientY;
          longPressTimer.current = setTimeout(() => {
            longPressTimer.current = null;
            openDurationDialog();
          }, 600);
          dragProps.onPointerDown?.(e);
        }}
        onPointerMove={(e) => {
          if (longPressTimer.current !== null) {
            const dx = Math.abs(e.clientX - pressStartX.current);
            const dy = Math.abs(e.clientY - pressStartY.current);
            if (dx > 8 || dy > 8) {
              clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
            }
          }
          dragProps.onPointerMove?.(e);
        }}
        onPointerUp={(e) => {
          if (longPressTimer.current !== null) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
          }
          dragProps.onPointerUp?.(e);
        }}
        onPointerCancel={(e) => {
          if (longPressTimer.current !== null) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
          }
          dragProps.onPointerCancel?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onTap();
        }}
      >
        {/* Zone de contenu: overflow-hidden pour ne pas deborder du bloc. */}
        <div
          className="absolute inset-y-0 left-0 flex cursor-grab items-center gap-1 overflow-hidden px-1.5 active:cursor-grabbing"
          style={{ right: HANDLE_PX }}
        >
          {/* L'icone redit la nature du bloc: la couleur seule ne suffit pas a
              distinguer deux teintes voisines sur un fond sombre. */}
          <span className="shrink-0 [&>svg]:size-2.5">
            {kind === 'lyric' ? <MusicIcon /> : <TextIcon />}
          </span>
          {width > TEXT_THRESHOLD_PX && (
            <span className="truncate">{overlay.text}</span>
          )}
        </div>

        {/* Poignee de redimensionnement (bord droit). */}
        <ResizeHandle overlay={overlay} pxPerSecond={pxPerSecond} write={write} />
      </div>

      {/* Dialogue de duree: rendu via portal pour sortir du translate3d parent. */}
      {showDurationDialog &&
        createPortal(
          <DurationDialog
            overlay={overlay}
            onChange={(duration) => write({ duration })}
            onClose={closeDurationDialog}
          />,
          document.body,
        )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Poignee de redimensionnement (bord droit du bloc)
// ---------------------------------------------------------------------------

interface ResizeHandleProps {
  overlay: TextOverlay;
  pxPerSecond: number;
  /** Ecriture routee vers `updateText` ou `updateLyricLine` selon la nature. */
  write: (patch: { start?: number; duration?: number }) => void;
}

/**
 * Poignee de redimensionnement de la duree d'une incrustation.
 *
 * Positionnee en absolu sur le bord droit du bloc parent.
 * Utilise setPointerCapture pour recevoir tous les evenements pointeur
 * meme quand le pointeur sort de l'element.
 *
 * stopPropagation sur pointerdown: empeche le drag de deplacement du bloc
 * parent de s'activer en meme temps que le redimensionnement.
 */
function ResizeHandle({ overlay, pxPerSecond, write }: ResizeHandleProps) {
  const origin = useRef({ duration: 0, startX: 0 });

  return (
    <div
      className="absolute inset-y-0 right-0 flex cursor-ew-resize items-center justify-center touch-none"
      style={{ width: HANDLE_PX }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        useProjectStore.temporal.getState().pause();
        origin.current = { duration: overlay.duration, startX: e.clientX };
      }}
      onPointerMove={(e) => {
        // stopPropagation defensif: empeche le scrub de la timeline parente
        // de recevoir les evenements captures via React's event delegation.
        e.stopPropagation();
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const dTime = (e.clientX - origin.current.startX) / pxPerSecond;
        write({ duration: Math.max(0.5, origin.current.duration + dTime) });
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const dTime = (e.clientX - origin.current.startX) / pxPerSecond;
        const settled = Math.max(0.5, origin.current.duration + dTime);
        write({ duration: origin.current.duration });
        useProjectStore.temporal.getState().resume();
        write({ duration: settled });
      }}
      onPointerCancel={() => {
        write({ duration: origin.current.duration });
        useProjectStore.temporal.getState().resume();
      }}
    >
      <span
        aria-hidden="true"
        className="block h-3.5 w-px rounded-full bg-current opacity-60"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogue de modification de duree (fallback pour les petits blocs)
// ---------------------------------------------------------------------------

interface DurationDialogProps {
  overlay: TextOverlay;
  onChange: (duration: number) => void;
  onClose: () => void;
}

/**
 * Modal de modification de duree d'une incrustation.
 * Accessible via appui long sur le corps du bloc.
 */
function DurationDialog({ overlay, onChange, onClose }: DurationDialogProps) {
  const { t } = useTranslation(['editor', 'common']);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 pb-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('editor:timeline.editDuration')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-ink-600 bg-ink-900 p-4"
      >
        <h2 className="text-base font-semibold tracking-tight text-ink-50">
          {t('editor:timeline.editDuration')}
        </h2>

        <div className="mt-2">
          <Slider
            label={t('editor:timeline.duration')}
            value={overlay.duration}
            min={0.5}
            max={30}
            step={0.1}
            onChange={onChange}
            displayValue={`${overlay.duration.toFixed(1)}\u00a0s`}
          />
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 min-h-12 w-full rounded-xl border border-ink-600 text-sm font-medium text-ink-200 active:bg-ink-800"
        >
          {t('common:action.close')}
        </button>
      </div>
    </div>
  );
}
