/**
 * Zoom du plan, en boutons, pose sur l'apercu.
 *
 * Le pincement existait deja (`useCropGesture`) et reste le geste principal. Ce
 * qu'il ne couvre pas: une SOURIS n'a pas deux doigts, et sur telephone pincer
 * demande la seconde main. Les boutons rendent le zoom accessible d'un pouce et
 * au clic, sans ouvrir le panneau Modifier — qui masque justement le bas de
 * l'image qu'on est en train de cadrer.
 *
 * Comme le geste, ils agissent sur le clip situe SOUS LA TETE DE LECTURE et non
 * sur le clip selectionne: on regle l'image que l'on voit.
 */

import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import {
  MAX_CLIP_SCALE,
  MIN_CLIP_SCALE,
  clampTransform,
  steppedScale,
} from '../../domain/project';
import { clipIndexAt } from '../../domain/timeline';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { useProjectStore } from '../../store/useProjectStore';
import { ZoomInIcon, ZoomOutIcon } from '../../components/ui/icons';

/** Clip sous la tete de lecture, ou `null` s'il n'y en a aucun. */
function clipAtPlayhead() {
  const project = useProjectStore.getState().project;
  const index = clipIndexAt(project.videoTrack, usePlaybackStore.getState().time);
  return index < 0 ? null : (project.videoTrack.clips[index] ?? null);
}

export function PreviewZoom() {
  const { t } = useTranslation('editor');

  /*
    L'echelle est lue par `useSyncExternalStore` et non par un selecteur Zustand:
    elle depend de DEUX stores a la fois (le projet pour le clip, la lecture pour
    savoir lequel). S'abonner aux deux et recomposer donnerait le meme resultat
    avec un rendu de plus, et le pourcentage affiche doit suivre le pincement en
    direct — donc a la frame.
  */
  const scale = useSyncExternalStore(
    (onChange) => {
      const unsubProject = useProjectStore.subscribe(onChange);
      const unsubPlayback = usePlaybackStore.subscribe(onChange);
      return () => {
        unsubProject();
        unsubPlayback();
      };
    },
    () => clipAtPlayhead()?.transform.scale ?? null,
    () => null,
  );

  // Aucun plan sous la tete de lecture: rien a zoomer, et un bouton actif qui ne
  // fait rien est pire qu'un bouton absent.
  if (scale === null) return null;

  const applyZoom = (direction: 1 | -1) => {
    const clip = clipAtPlayhead();
    if (!clip) return;

    /*
      Passage par `clampTransform` et non ecriture directe de l'echelle:
      DEZOOMER retrecit l'amplitude de deplacement disponible, et un decalage
      pose a 500 % deviendrait hors limites une fois revenu a 100 % — l'image
      partirait alors hors du cadre.
    */
    const project = useProjectStore.getState().project;
    const asset = project.assets[clip.assetId];
    const source =
      asset?.width !== undefined && asset.height !== undefined
        ? { width: asset.width, height: asset.height }
        : undefined;

    useProjectStore.getState().updateClip(clip.id, {
      transform: clampTransform(
        { ...clip.transform, scale: steppedScale(clip.transform.scale, direction) },
        { source, frame: project.frame, fit: clip.fit },
      ),
    });
  };

  const atMin = scale <= MIN_CLIP_SCALE + 1e-6;
  const atMax = scale >= MAX_CLIP_SCALE - 1e-6;

  /*
    `pointerdown` plutot que `click`, et propagation stoppee.

    Le canvas porte le geste de recadrage ET le tap qui lance la lecture. Sans
    cette isolation, appuyer sur un bouton de zoom demarrait la lecture; et un
    `preventDefault` en amont tue le clic de synthese a la souris — mesure sur
    PC, ou les boutons devenaient inertes alors qu'ils marchaient au doigt.
  */
  const press = (direction: 1 | -1) => (event: React.PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    applyZoom(direction);
  };

  const buttonClass = [
    'pointer-events-auto flex size-9 items-center justify-center rounded-full',
    'bg-ink-950/60 text-ink-200 backdrop-blur-sm active:bg-ink-950/85',
    'disabled:opacity-60 [&>svg]:size-4',
  ].join(' ');

  return (
    <div
      className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label={t('preview.zoomOut')}
        disabled={atMin}
        onPointerDown={press(-1)}
        className={buttonClass}
      >
        <ZoomOutIcon />
      </button>

      {/*
        Le pourcentage n'est pas decoratif: il dit ou l'on en est entre 20 % et
        250 %, et surtout il permet de reperer un plan reste a 100 % au milieu
        d'autres zoomes. `tabular-nums` fige la largeur, sans quoi la ligne
        sautille a chaque pression.
      */}
      <span
        aria-label={t('edit.zoom')}
        className="pointer-events-none min-w-[3rem] rounded-full bg-ink-950/60 px-2 py-1 text-center text-[11px] font-medium tabular-nums text-ink-300 backdrop-blur-sm"
      >
        {Math.round(scale * 100)}%
      </span>

      <button
        type="button"
        aria-label={t('preview.zoomIn')}
        disabled={atMax}
        onPointerDown={press(1)}
        className={buttonClass}
      >
        <ZoomInIcon />
      </button>
    </div>
  );
}
