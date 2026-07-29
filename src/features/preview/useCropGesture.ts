/**
 * Recadrage direct au doigt sur l'apercu.
 *
 * Pincer zoome, glisser deplace l'image dans le cadre. C'est le geste attendu
 * de toute application photo, et il remplace l'aller-retour vers trois curseurs
 * dans un panneau qui masque l'image qu'on regle.
 *
 * Le geste agit sur le clip situe SOUS LA TETE DE LECTURE, jamais sur le clip
 * selectionne: on recadre l'image que l'on voit. Les deux peuvent diverger, et
 * regler le cadrage d'une image invisible donnerait l'impression d'un reglage
 * sans effet.
 *
 * Pendant le geste, la transformation est poussee dans le store a chaque frame:
 * l'apercu se redessine donc en direct. L'historique d'annulation est en
 * revanche marque une seule fois, a la FIN — sans quoi un pincement deposerait
 * cinquante entrees et « Annuler » ne reviendrait qu'un cran en arriere.
 */

import { useCallback, useRef } from 'react';
import { useGesture } from '@use-gesture/react';

import { usePlaybackStore } from '../../store/usePlaybackStore';
import { useProjectStore } from '../../store/useProjectStore';
import { MAX_CLIP_SCALE, clampTransform } from '../../domain/project';
import { clipIndexAt } from '../../domain/timeline';
import type { ClipTransform } from '../../domain/types';

/**
 * Distance en pixels au-dela de laquelle un glissement est un recadrage.
 *
 * En deca, le geste reste un simple tap: appuyer sur l'apercu doit continuer a
 * lancer et arreter la lecture.
 */
const DRAG_THRESHOLD = 8;

export function useCropGesture(enabled: boolean) {
  // Transformation au debut du geste: tout le mouvement s'y rapporte, sinon les
  // deltas s'accumuleraient sur une valeur deja modifiee et le zoom filerait.
  const origin = useRef<ClipTransform | null>(null);
  const moved = useRef(false);

  /**
   * Surface de reference du geste, a attacher au canvas.
   *
   * Indispensable: on ne peut pas mesurer via `event.currentTarget`, que la
   * librairie de gestes ne garantit pas etre un element du DOM.
   */
  const surfaceRef = useRef<HTMLCanvasElement | null>(null);

  /** Clip actuellement sous la tete de lecture, ou `null`. */
  const currentClip = () => {
    const project = useProjectStore.getState().project;
    const index = clipIndexAt(project.videoTrack, usePlaybackStore.getState().time);
    return index < 0 ? null : (project.videoTrack.clips[index] ?? null);
  };

  const begin = () => {
    const clip = currentClip();
    origin.current = clip ? { ...clip.transform } : null;
    moved.current = false;
    return clip;
  };

  const apply = (next: Partial<ClipTransform>) => {
    const clip = currentClip();
    const from = origin.current;
    if (!clip || !from) return;

    /*
      Le contexte est indispensable ici: sans lui, le plafond fixe de 0,4 bloque
      le glissement bien avant le bord de l'image des qu'on zoome. Mesure a 5x
      sur une photo 3:4, seuls 14 % de l'image restaient atteignables.

      Les dimensions viennent de l'asset et peuvent manquer (media non sonde):
      `offsetLimitFor` retombe alors sur le plafond fixe, ce qui est le bon
      repli — mieux vaut brider que laisser filer un plan hors du cadre.
    */
    const project = useProjectStore.getState().project;
    const asset = project.assets[clip.assetId];
    const source =
      asset?.width !== undefined && asset.height !== undefined
        ? { width: asset.width, height: asset.height }
        : undefined;

    useProjectStore.getState().updateClip(clip.id, {
      transform: clampTransform(
        { ...from, ...next },
        { source, frame: project.frame, fit: clip.fit },
      ),
    });
  };

  /**
   * Cloture: UNE seule entree d'historique pour tout le geste.
   *
   * Les mises a jour intermediaires se font historique en pause, sinon un
   * pincement en deposerait cinquante et « Annuler » ne reculerait que d'une
   * frame. On reprend l'historique, puis on reecrit l'etat final: c'est cette
   * derniere ecriture, et elle seule, qui devient le point d'annulation.
   */
  const end = () => {
    const from = origin.current;
    origin.current = null;

    const store = useProjectStore.getState();
    const temporal = useProjectStore.temporal.getState();
    const clip = currentClip();

    if (!from || !moved.current || !clip) {
      temporal.resume();
      return;
    }

    // On repose d'abord le cadrage d'AVANT le geste, toujours en pause: l'etat
    // visible ne bouge que le temps d'un rendu synchrone, invisible a l'oeil.
    const settled = { ...clip.transform };
    store.updateClip(clip.id, { transform: from });

    // Puis, historique actif, on rejoue l'etat final. Le passage `from -> settled`
    // devient ainsi l'unique point d'annulation du geste. Rejouer une valeur
    // identique aurait pu etre ecarte par le test d'egalite de zundo.
    temporal.resume();
    store.updateClip(clip.id, { transform: settled });
  };

  const bind = useGesture(
    {
      onDragStart: () => {
        if (!enabled) return;
        useProjectStore.temporal.getState().pause();
        begin();
      },
      onDrag: ({ movement: [mx, my], event }) => {
        if (!enabled || !origin.current) return;
        if (Math.hypot(mx, my) < DRAG_THRESHOLD) return;
        moved.current = true;
        // Le glissement ne doit pas devenir un defilement de page. `preventDefault`
        // n'existe pas sur tous les evenements remontes par la librairie, et le
        // listener peut etre passif: on ne s'y fie donc pas.
        if (typeof event.preventDefault === 'function' && event.cancelable) {
          event.preventDefault();
        }

        // Le rectangle vient de la REF, jamais de `event.currentTarget`: la
        // librairie de gestes remonte parfois la fenetre ou un noeud sans
        // `getBoundingClientRect`, et l'appeler levait une TypeError a chaque
        // frame de glissement. L'exception traversait le rendu React et faisait
        // disparaitre des pans de l'interface (la piste texte, notamment).
        const rect = surfaceRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0 || rect.height === 0) return;

        // Le mouvement est converti en unites normalisees de la frame: un
        // glissement d'un tiers de l'apercu deplace l'image d'un tiers, quelle
        // que soit la taille reelle du canvas.
        apply({
          x: origin.current.x + mx / rect.width,
          y: origin.current.y + my / rect.height,
        });
      },
      onDragEnd: end,

      onPinchStart: () => {
        if (!enabled) return;
        useProjectStore.temporal.getState().pause();
        begin();
        moved.current = true;
      },
      onPinch: ({ offset: [scale] }) => {
        if (!enabled || !origin.current) return;
        apply({ scale: origin.current.scale * scale });
      },
      onPinchEnd: end,
    },
    {
      drag: { filterTaps: true, pointer: { touch: true } },
      /*
        L'echelle part de 1 a chaque pincement: elle est RELATIVE a la valeur
        d'origine, que `apply` multiplie. La borne basse (0.08) couvre le
        dezoom jusqu'a 20% quand l'origine est a 100% (0.08 * 1 = 0.08 < 0.2
        mais clampTransform ramene a MIN_CLIP_SCALE).

        Borne haute portee de 4 a 5 avec le plafond de zoom: laissee a 4, elle
        interdisait au pincement d'atteindre les 500 % que les boutons et le
        curseur permettent — le meme reglage aurait eu deux limites selon la
        voie empruntee.
      */
      pinch: { scaleBounds: { min: 0.08, max: MAX_CLIP_SCALE }, from: () => [1, 0] },
    },
  );

  /**
   * Rappel de ref a attacher au canvas.
   *
   * Une fonction plutot que la ref nue: l'appelant a deja sa propre ref sur ce
   * noeud, et lui faire ecrire dans un objet renvoye par un hook serait une
   * mutation de valeur externe.
   */
  const attachSurface = useCallback((node: HTMLCanvasElement | null) => {
    surfaceRef.current = node;
  }, []);

  return { bind, attachSurface, hasMoved: () => moved.current };
}
