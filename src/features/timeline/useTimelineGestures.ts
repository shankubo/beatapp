/**
 * Gestes de la timeline.
 *
 * Trois principes qui rendent l'edition praticable au pouce sur un ecran de
 * 390 px:
 *
 * 1. La TETE DE LECTURE EST FIXE AU CENTRE et le contenu defile dessous. C'est
 *    ce qui permet un positionnement precis d'un seul pouce: la cible ne bouge
 *    jamais, seule la matiere se deplace.
 * 2. Le pinch est ancre au MILIEU DES DEUX DOIGTS, pas a la tete de lecture:
 *    zoomer doit garder sous le doigt ce qu'on regarde.
 * 3. Pendant un geste, on n'ecrit que dans un etat transitoire et on ne
 *    transforme que par `translate3d`. Aucun reflow, aucun re-rendu React par
 *    frame: c'est la condition pour tenir 60 fps sur un telephone milieu de
 *    gamme.
 */

import { useCallback, useMemo, useRef } from 'react';
import { useDrag, usePinch } from '@use-gesture/react';

import { usePlaybackStore } from '../../store/usePlaybackStore';
import {
  MAX_PX_PER_SECOND,
  MIN_PX_PER_SECOND,
  useUiStore,
} from '../../store/useUiStore';
import { clamp } from '../../lib/math';
import { CONTROLS_W } from './TrackControls';

export interface TimelineGeometry {
  pxPerSecond: number;
  duration: number;
  /** Largeur visible en pixels CSS. */
  viewportWidth: number;
}

/**
 * Convertit une position de defilement en temps, et inversement.
 *
 * Le contenu est rembourre d'une demi-largeur de part et d'autre, pour que le
 * premier et le dernier instant puissent atteindre le centre de l'ecran.
 */
export function timelineFromScroll(scrollLeft: number, geometry: TimelineGeometry): number {
  return scrollLeft / geometry.pxPerSecond;
}

export function scrollFromTimeline(time: number, geometry: TimelineGeometry): number {
  return time * geometry.pxPerSecond;
}

interface ScrubOptions {
  geometry: TimelineGeometry;
  /** Aimante un temps sur la grille rythmique, si l'aimantation est active. */
  snap?: (time: number) => number;
}

/**
 * Scrub par glissement horizontal.
 *
 * Le geste ecrit directement dans le store de lecture (transitoire, hors
 * historique d'annulation): faire reculer la tete de lecture ne doit jamais
 * apparaitre dans les annulations.
 */
export function useScrubGesture({ geometry, snap }: ScrubOptions) {
  const setTime = usePlaybackStore((state) => state.setTime);
  const setScrubbing = usePlaybackStore((state) => state.setScrubbing);
  const setPlaying = usePlaybackStore((state) => state.setPlaying);

  // Temps au debut du geste: on calcule toujours par rapport a lui, jamais de
  // facon incrementale (le cumul de deltas derive).
  const startTime = useRef(0);

  return useDrag(
    ({ first, last, movement: [mx], event }) => {
      if (first) {
        startTime.current = usePlaybackStore.getState().time;
        setScrubbing(true);
        // Un scrub interrompt la lecture: sinon l'horloge audio et le doigt se
        // disputent la position.
        setPlaying(false);
      }

      /**
       * Un appui SANS deplacement n'est pas un scrub: on ne touche a rien.
       *
       * Deux effets de bord, tous deux invisibles au tactile et bloquants au
       * clavier-souris, venaient de traiter le simple clic comme un geste:
       *
       * - `event.preventDefault()` des la premiere frame supprimait le `click`
       *   de synthese de tout bouton pose dans la timeline (cadenas, aimant,
       *   zoom, « ajouter un media »). Avec `pointer.touch`, le geste passe par
       *   les evenements tactiles sur telephone, ou annuler le defaut ne tue pas
       *   le clic — d'ou un bug total sur PC et nul sur iPhone.
       * - `setTime` etait appele meme a deplacement nul, ce qui deplacait la
       *   tete de lecture et re-rendait l'arbre sous le doigt au moment precis
       *   ou le bouton attendait son clic.
       *
       * On sort donc tant que le doigt n'a pas bouge. `filterTaps` ne suffit
       * pas: il filtre le `tap` final, pas les frames intermediaires.
       */
      if (mx === 0) {
        if (last) setScrubbing(false);
        return;
      }

      if (event.cancelable) event.preventDefault();

      // Glisser vers la GAUCHE avance dans le temps: le contenu suit le doigt.
      const raw = startTime.current - mx / geometry.pxPerSecond;
      const bounded = clamp(raw, 0, geometry.duration);
      setTime(snap ? snap(bounded) : bounded);

      if (last) setScrubbing(false);
    },
    { axis: 'x', filterTaps: true, pointer: { touch: true } },
  );
}

/**
 * Pinch-zoom de la timeline.
 *
 * L'ancrage au milieu des doigts impose de corriger la position de defilement:
 * sans cela, le zoom se ferait autour du bord gauche et le contenu regarde
 * s'echapperait de l'ecran.
 *
 * Le centre de reference est `CONTROLS_W + viewportWidth / 2`, le meme point que
 * vise `offsetPx` dans les bandes: la colonne cadenas/aimant occupe les premiers
 * pixels, et l'ignorer decalait l'ancre de 44 px — le contenu glissait alors
 * lateralement pendant le zoom au lieu de rester sous les doigts.
 */
/** Facteur applique a chaque crantee de molette: ~12 % par cran. */
const WHEEL_ZOOM_STEP = 1.12;

export function usePinchZoom(geometry: TimelineGeometry) {
  const pxPerSecond = useUiStore((state) => state.pxPerSecond);
  const setPxPerSecond = useUiStore((state) => state.setPxPerSecond);
  const setTime = usePlaybackStore((state) => state.setTime);

  const initial = useRef({ pxPerSecond: 60, anchorTime: 0 });

  return usePinch(
    ({ first, offset: [scale], origin: [originX], touches, event, memo }) => {
      const element = memo as DOMRect | undefined;

      if (first) {
        const currentTime = usePlaybackStore.getState().time;
        // Temps se trouvant sous le milieu des deux doigts au debut du geste.
        const offsetFromCenter = originX - (CONTROLS_W + geometry.viewportWidth / 2);
        initial.current = {
          pxPerSecond,
          anchorTime: currentTime + offsetFromCenter / pxPerSecond,
        };
      }

      /**
       * A la molette, `scale` monte beaucoup trop vite.
       *
       * Deux doigts donnent un rapport de distances, physiquement dose. Une
       * crantee de molette vaut `deltaY = 120` et produisait un facteur ~2,2:
       * le zoom sautait de 100 % a 220 % d'un seul cran.
       *
       * On ne peut pas simplement diviser l'ecart: `scale` est un offset CUMULE
       * et un geste molette ne se termine jamais franchement, si bien que les
       * crantees successives repartaient toujours du meme `initial` et
       * s'emballaient (100 -> 120 -> 197 -> 328 %). On applique donc, hors
       * pinch a deux doigts, un pas CONSTANT relatif au zoom courant: chaque
       * crantee vaut le meme pourcentage, dans un sens comme dans l'autre.
       */
      let next: number;
      if (touches >= 2) {
        next = initial.current.pxPerSecond * scale;
      } else {
        /*
          Le SENS vient de l'evenement, pas de `scale`.

          `scale` est borne par `scaleBounds`: une fois la borne atteinte il ne
          bouge plus, et un pas deduit de sa variation se figeait (100 -> 112 ->
          125 % puis plus rien). `deltaY` du `wheel`, lui, reste fidele a chaque
          crantee.
        */
        const delta = (event as WheelEvent).deltaY ?? 0;
        next =
          delta === 0
            ? pxPerSecond
            : pxPerSecond * (delta < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP);
      }

      next = clamp(next, MIN_PX_PER_SECOND, MAX_PX_PER_SECOND);
      setPxPerSecond(next);

      /*
        On replace la tete de lecture pour que le point vise reste sous le
        curseur. Meme centre de reference qu'a l'ancrage, sans quoi le contenu
        glisserait de `CONTROLS_W` pendant le geste.

        A la molette, l'ancre est recalculee a CHAQUE crantee: le geste n'a pas
        de debut franc, donc `initial.anchorTime` — fige au premier evenement —
        ferait deriver la timeline au fil des crans.
      */
      const settled = originX - (CONTROLS_W + geometry.viewportWidth / 2);
      const anchor =
        touches >= 2
          ? initial.current.anchorTime
          : usePlaybackStore.getState().time + settled / pxPerSecond;
      const targetTime = anchor - settled / next;
      setTime(clamp(targetTime, 0, geometry.duration));

      return element;
    },
    {
      // `scaleBounds` borne le facteur cumule; les bornes absolues de zoom sont
      // appliquees ci-dessus, car elles dependent du zoom de depart.
      scaleBounds: { min: 0.2, max: 5 },
      rubberband: true,
      /**
       * Zoom au clavier-souris.
       *
       * `pinchOnWheel` est deja actif par defaut, mais il exige `ctrlKey` et il
       * traduit une crantee (`deltaY = 120`) en un facteur enorme: le zoom
       * sautait de 100 % a 220 % d'un seul cran. `modifierKey: null` retire
       * l'obligation de tenir Ctrl, et le lissage de l'echelle se fait dans le
       * gestionnaire ci-dessus.
       *
       * Le pinch de trackpad arrive lui aussi sous forme de `wheel + ctrlKey`:
       * les deux gestes de bureau passent donc par le meme chemin.
       */
      modifierKey: null,
      eventOptions: { passive: false },
    },
  );
}

/** Retour haptique bref lors d'une aimantation. */
export function useSnapHaptics() {
  const lastSnapped = useRef<number | null>(null);

  return useCallback((snappedTime: number | null) => {
    if (snappedTime === null) {
      lastSnapped.current = null;
      return;
    }
    // On ne vibre qu'au moment ou l'aimantation ACCROCHE, pas a chaque frame
    // passee sur le meme point.
    if (lastSnapped.current === snappedTime) return;
    lastSnapped.current = snappedTime;
    navigator.vibrate?.(8);
  }, []);
}

/** Geometrie derivee, memoisee pour eviter de recreer les gestes a chaque frame. */
export function useTimelineGeometry(duration: number, viewportWidth: number): TimelineGeometry {
  const pxPerSecond = useUiStore((state) => state.pxPerSecond);
  return useMemo(
    () => ({ pxPerSecond, duration, viewportWidth }),
    [pxPerSecond, duration, viewportWidth],
  );
}
