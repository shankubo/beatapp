/**
 * Panneau Modifier: agit sur l'element selectionne.
 *
 * C'est le point d'entree unique des retouches d'un plan deja pose:
 * remplacer le media, le deplacer, ajuster sa duree, recadrer, dupliquer,
 * supprimer. Les reglages d'apparence (transition, filtre) restent dans
 * « Effets »: les melanger ferait un panneau qu'on ne peut plus parcourir au
 * pouce.
 *
 * Sans selection, le panneau propose de choisir un clip plutot que d'afficher
 * une page vide.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectStore } from '../../store/useProjectStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { useUiStore } from '../../store/useUiStore';
import { useMedia } from '../preview/MediaProvider';
import { Segmented } from '../../components/ui/Segmented';
import { Slider } from '../../components/ui/Slider';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CopyIcon,
  PhotoIcon,
  RotateLeftIcon,
  RotateRightIcon,
  SwapIcon,
  TextIcon,
  TrashIcon,
} from '../../components/ui/icons';
import { acceptAttribute } from '../import/validateFile';
import { ImportError, importFile } from '../import/importMedia';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { MIN_CLIP_DURATION } from '../../domain/types';
import { clipIndexAt } from '../../domain/timeline';
// Bornes partagees avec le geste de recadrage direct sur l'apercu: deux jeux de
// valeurs divergents laisseraient le geste produire un cadrage que ces curseurs
// ne sauraient pas representer.
import {
  MAX_CLIP_SCALE,
  MAX_CLIP_TILT,
  MIN_CLIP_SCALE,
  clampTransform,
  joinRotation,
  offsetLimitFor,
  splitRotation,
} from '../../domain/project';
import { formatDegrees, formatDuration } from '../../lib/format';

export function EditSheet() {
  const { t, i18n } = useTranslation(['editor', 'common', 'errors']);

  const project = useProjectStore((state) => state.project);
  const updateClip = useProjectStore((state) => state.updateClip);
  const setClipDuration = useProjectStore((state) => state.setClipDuration);
  const replaceClipAsset = useProjectStore((state) => state.replaceClipAsset);
  const duplicateClip = useProjectStore((state) => state.duplicateClip);
  const removeClip = useProjectStore((state) => state.removeClip);
  const moveClip = useProjectStore((state) => state.moveClip);

  const selectedId = usePlaybackStore((state) => state.selectedClipId);
  const selectClip = usePlaybackStore((state) => state.selectClip);
  const currentTime = usePlaybackStore((state) => state.time);
  const openTab = useUiStore((state) => state.openTab);
  const pushToast = useUiStore((state) => state.pushToast);

  const { register, blobs } = useMedia();

  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);

  const clips = project.videoTrack.clips;
  const selectedIndex = clips.findIndex((clip) => clip.id === selectedId);

  // A defaut de selection, on agit sur le clip visible a la position de lecture:
  // c'est celui que l'utilisateur a sous les yeux.
  const index =
    selectedIndex >= 0 ? selectedIndex : clipIndexAt(project.videoTrack, currentTime);
  const clip = index >= 0 ? clips[index] : undefined;

  // Rien sous la tete de lecture non plus: on montre les plans a choisir. C'est
  // plus utile qu'un message d'absence, et c'est le geste que l'utilisateur
  // allait faire.
  if (!clip) {
    return <ClipPicker />;
  }

  const asset = project.assets[clip.assetId];
  const isVideo = asset?.kind === 'video';

  /*
    Amplitude de deplacement disponible, qui suit le zoom et le format.

    Calculee ici plutot que figee: le compositeur agrandit autour du centre, donc
    l'amplitude utile depend de combien l'image deborde du cadre. Sans
    dimensions sondees, `offsetLimitFor` retombe sur le plafond fixe.
  */
  const clampSource =
    asset?.width !== undefined && asset.height !== undefined
      ? { width: asset.width, height: asset.height }
      : undefined;

  const offsetLimit = offsetLimitFor(
    clampSource,
    project.frame,
    clip.fit,
    clip.transform.scale,
  );

  /*
    Le modele ne stocke qu'un angle; l'interface en expose deux. La decomposition
    se fait donc a l'affichage, et non dans le projet — stocker les deux
    obligerait a les additionner partout, avec le risque d'en oublier un.

    Pas de `useMemo`: le calcul est trivial et se trouve apres un retour anticipe,
    ou les hooks sont interdits.
  */
  const rotation = splitRotation(clip.transform.rotation);

  /** Remplace le media du clip en conservant sa place dans le montage. */
  const handleReplace = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    setBusy(true);
    try {
      const { asset: next, blob } = await importFile(file, { accept: ['image', 'video'] });
      await register(next, blob);
      replaceClipAsset(clip.id, next);
    } catch (error) {
      pushToast({
        i18nKey: error instanceof ImportError ? error.i18nKey : 'errors:import.decodeFailed',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Suppression, avec ou sans vide.
   *
   * `leaveGap` laisse un trou de la duree du plan a sa place. C'est le seul
   * moyen de retirer une image sans decaler tout ce qui suit — indispensable
   * quand le son et le texte sont deja cales sur la suite du montage.
   */
  const handleDelete = (leaveGap: boolean) => {
    setConfirmingDelete(false);
    removeClip(clip.id, { leaveGap });
    // La selection pointerait sur un clip disparu.
    selectClip(null);
  };

  return (
    <div className="space-y-5 pt-1">
      <header className="flex items-center gap-3">
        <span className="size-14 shrink-0 overflow-hidden rounded-lg border border-ink-600 bg-ink-850">
          {(() => {
            const blob = blobs.get(clip.assetId);
            return blob ? (
              <ClipThumbnail blob={blob} />
            ) : (
              <span className="flex size-full items-center justify-center text-ink-400 [&>svg]:size-5">
                <PhotoIcon />
              </span>
            );
          })()}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-50">
            {t('editor:timeline.clip', { index: index + 1 })}
          </p>
          {/* Nom de fichier: affiche comme du texte, jamais interprete. */}
          <p className="truncate text-xs text-ink-400">{asset?.name}</p>
        </div>
      </header>

      {/* --- Remplacer / dupliquer --- */}
      <section className="grid grid-cols-2 gap-2">
        <ActionButton
          icon={<SwapIcon />}
          label={t('editor:edit.replace')}
          disabled={busy}
          onClick={() => replaceInput.current?.click()}
        />
        <ActionButton
          icon={<CopyIcon />}
          label={t('editor:edit.duplicate')}
          onClick={() => duplicateClip(clip.id)}
        />
      </section>

      <input
        ref={replaceInput}
        type="file"
        accept={acceptAttribute(['image', 'video'])}
        className="hidden"
        onChange={(event) => {
          void handleReplace(event.target.files);
          event.target.value = '';
        }}
      />

      {/* --- Deplacer --- */}
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
          {t('editor:edit.move')}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <ActionButton
            icon={<ArrowLeftIcon />}
            label={t('editor:edit.moveEarlier')}
            disabled={index === 0}
            onClick={() => moveClip(index, index - 1)}
          />
          <ActionButton
            icon={<ArrowRightIcon />}
            label={t('editor:edit.moveLater')}
            disabled={index >= clips.length - 1}
            onClick={() => moveClip(index, index + 1)}
          />
        </div>
      </section>

      {/* --- Duree --- */}
      <section>
        <Slider
          label={t('editor:timeline.duration')}
          value={clip.duration}
          min={MIN_CLIP_DURATION}
          // Une video ne peut pas durer plus que sa source; une image, si.
          max={isVideo ? Math.max(clip.duration, asset?.duration ?? 10) : 10}
          step={0.1}
          onChange={(duration) => setClipDuration(clip.id, duration)}
          displayValue={formatDuration(clip.duration, i18n.language)}
        />
        {clip.beatLocked && (
          <p className="text-xs text-beat-400">{t('editor:edit.beatLockedHint')}</p>
        )}
      </section>

      {/* --- Recadrage --- */}
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
          {t('editor:edit.crop')}
        </h3>

        {/* Le geste direct est le chemin principal; les curseurs restent la pour
            le reglage fin. Sans cette ligne, personne ne devinerait qu'on peut
            pincer l'apercu. */}
        <p className="text-xs leading-relaxed text-ink-400">{t('editor:edit.cropHint')}</p>

        <Segmented
          label={t('editor:clip.fit')}
          options={[
            { value: 'cover', label: t('editor:clip.fitCover') },
            { value: 'contain', label: t('editor:clip.fitContain') },
          ]}
          value={clip.fit}
          onChange={(fit) => updateClip(clip.id, { fit })}
        />

        <Slider
          label={t('editor:edit.zoom')}
          value={clip.transform.scale}
          min={MIN_CLIP_SCALE}
          max={MAX_CLIP_SCALE}
          step={0.02}
          /*
            Passe par `clampTransform`, contrairement aux autres curseurs.

            DEZOOMER retrecit l'amplitude de deplacement disponible: un decalage
            pose a 500 % devient hors limites une fois revenu a 100 %, et
            l'image partirait hors du cadre. Le bornage ramene x et y dans la
            nouvelle amplitude au moment ou l'echelle change.
          */
          onChange={(scale) =>
            updateClip(clip.id, {
              transform: clampTransform(
                { ...clip.transform, scale },
                { source: clampSource, frame: project.frame, fit: clip.fit },
              ),
            })
          }
          displayValue={`${Math.round(clip.transform.scale * 100)} %`}
        />
        {/*
          Les bornes de position SUIVENT le zoom.

          Figees a 0,4, elles bloquaient le curseur bien avant le bord de
          l'image: mesure a 500 % sur une photo 3:4, seuls 14 % de l'image
          restaient atteignables. Le geste direct utilise exactement la meme
          fonction, sans quoi les deux voies borneraient differemment.
        */}
        <Slider
          label={t('editor:edit.offsetX')}
          value={clip.transform.x}
          min={-offsetLimit.x}
          max={offsetLimit.x}
          step={0.01}
          onChange={(x) => updateClip(clip.id, { transform: { ...clip.transform, x } })}
        />
        <Slider
          label={t('editor:edit.offsetY')}
          value={clip.transform.y}
          min={-offsetLimit.y}
          max={offsetLimit.y}
          step={0.01}
          onChange={(y) => updateClip(clip.id, { transform: { ...clip.transform, y } })}
        />

        {/*
          Orientation. Deux reglages distincts pour deux besoins qui n'ont rien a
          voir: redresser une photo couchee (quart de tour) et incliner pour le
          style (quelques degres). Un curseur unique de -180 a +180 rendrait le
          premier — pourtant le plus frequent — penible a viser au doigt.
        */}
        <div className="space-y-2">
          <span className="block text-xs font-medium text-ink-400">
            {t('editor:edit.orientation')}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                updateClip(clip.id, {
                  transform: {
                    ...clip.transform,
                    rotation: joinRotation(rotation.quarters - 1, rotation.tilt),
                  },
                })
              }
              aria-label={t('editor:edit.rotateLeft')}
              className="surface flex min-h-11 flex-1 items-center justify-center rounded-xl border border-ink-600 bg-ink-850 text-ink-200 active:bg-ink-800 [&>svg]:size-5"
            >
              <RotateLeftIcon />
            </button>
            <button
              type="button"
              onClick={() =>
                updateClip(clip.id, {
                  transform: {
                    ...clip.transform,
                    rotation: joinRotation(rotation.quarters + 1, rotation.tilt),
                  },
                })
              }
              aria-label={t('editor:edit.rotateRight')}
              className="surface flex min-h-11 flex-1 items-center justify-center rounded-xl border border-ink-600 bg-ink-850 text-ink-200 active:bg-ink-800 [&>svg]:size-5"
            >
              <RotateRightIcon />
            </button>
            <span className="tnum w-14 shrink-0 text-right text-xs text-ink-400">
              {formatDegrees(rotation.quarters * 90, i18n.language)}
            </span>
          </div>
        </div>

        <Slider
          label={t('editor:edit.tilt')}
          value={rotation.tilt}
          min={-MAX_CLIP_TILT}
          max={MAX_CLIP_TILT}
          step={0.005}
          onChange={(tilt) =>
            updateClip(clip.id, {
              transform: {
                ...clip.transform,
                rotation: joinRotation(rotation.quarters, tilt),
              },
            })
          }
          displayValue={formatDegrees((rotation.tilt * 180) / Math.PI, i18n.language)}
        />

        <button
          type="button"
          onClick={() =>
            updateClip(clip.id, { transform: { scale: 1, x: 0, y: 0, rotation: 0 } })
          }
          className="min-h-11 w-full surface rounded-xl border border-ink-600 bg-ink-850 text-sm font-medium text-ink-200 active:bg-ink-800"
        >
          {t('editor:edit.resetCrop')}
        </button>
      </section>

      {/* --- Son du clip video --- */}
      {isVideo && (
        <label className="flex items-center justify-between gap-3 rounded-xl border border-ink-600 bg-ink-850 p-3">
          <span className="text-sm text-ink-200">{t('editor:clip.muteOriginal')}</span>
          <input
            type="checkbox"
            checked={clip.muted}
            onChange={(event) => updateClip(clip.id, { muted: event.target.checked })}
            className="size-5 accent-[var(--color-beat-400)]"
          />
        </label>
      )}

      {/* --- Renvois vers les panneaux dedies --- */}
      <section className="grid grid-cols-2 gap-2">
        <ActionButton
          icon={<TextIcon />}
          label={t('editor:edit.addText')}
          onClick={() => openTab('text')}
        />
        <ActionButton
          icon={<PhotoIcon />}
          label={t('editor:edit.openEffects')}
          onClick={() => openTab('effects')}
        />
      </section>

      {/* --- Suppression, en dernier et visuellement distincte --- */}
      <button
        type="button"
        onClick={() => setConfirmingDelete(true)}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-danger-500/40 text-sm font-medium text-danger-500 active:bg-danger-500/10 [&>svg]:size-4"
      >
        <TrashIcon />
        {t('editor:edit.delete')}
      </button>

      {/*
        Deux suppressions, deux consequences distinctes — donc deux boutons et
        non une case a cocher: le choix est fait AU MOMENT de detruire, pas
        reglé a l'avance et oublie.
      */}
      {confirmingDelete && (
        <div className="space-y-2 rounded-xl border border-danger-500/40 bg-ink-850 p-3">
          <p className="text-sm font-medium text-ink-200">
            {t('editor:edit.deleteConfirmTitle')}
          </p>

          <button
            type="button"
            onClick={() => handleDelete(false)}
            className="min-h-12 w-full rounded-xl border border-danger-500/40 text-sm font-medium text-danger-500 active:bg-danger-500/10"
          >
            {t('editor:edit.deleteAndClose')}
          </button>
          <p className="text-xs text-ink-400">{t('editor:edit.deleteAndCloseHint')}</p>

          <button
            type="button"
            onClick={() => handleDelete(true)}
            className="min-h-12 w-full rounded-xl border border-ink-600 text-sm font-medium text-ink-200 active:bg-ink-800"
          >
            {t('editor:edit.deleteLeaveGap')}
          </button>
          <p className="text-xs text-ink-400">{t('editor:edit.deleteLeaveGapHint')}</p>

          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="min-h-11 w-full text-sm text-ink-400 active:text-ink-200"
          >
            {t('common:action.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Choix du clip a modifier, quand rien n'est selectionne. */
function ClipPicker() {
  const { t, i18n } = useTranslation(['editor']);

  const clips = useProjectStore((state) => state.project.videoTrack.clips);
  const assets = useProjectStore((state) => state.project.assets);
  const selectClip = usePlaybackStore((state) => state.selectClip);
  const setTime = usePlaybackStore((state) => state.setTime);
  const { blobs } = useMedia();

  /**
   * Selectionne un plan ET amene la tete de lecture dessus.
   *
   * Les deux vont ensemble: sans le deplacement, on reglerait le filtre d'un plan
   * tout en regardant un autre plan dans l'apercu — les changements sembleraient
   * alors sans effet. On se place legerement apres le debut pour eviter de tomber
   * pile sur la frontiere avec le plan precedent.
   */
  const pick = (clipId: string, start: number) => {
    selectClip(clipId);
    setTime(start + 0.05);
  };

  if (clips.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-ink-400">{t('editor:media.emptyHint')}</p>
    );
  }

  return (
    // Meme contenant que la bibliotheque de l'onglet Media: les deux grilles de
    // vignettes se ressemblent, donc elles se lisent de la meme facon.
    <div className="space-y-3 rounded-2xl bg-ink-850 p-3">
      <p className="text-sm text-ink-400">{t('editor:edit.selectPrompt')}</p>
      {/* Colonnes variables: sur un ecran large, trois colonnes fixes
          donneraient des vignettes enormes et masqueraient les plans suivants
          sous la ligne de flottaison. */}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2">
        {clips.map((clip, index) => {
          const blob = blobs.get(clip.assetId);
          return (
            <li key={clip.id}>
              <button
                type="button"
                onClick={() => pick(clip.id, clip.start)}
                aria-label={t('editor:timeline.clip', { index: index + 1 })}
                className="relative block aspect-square w-full overflow-hidden rounded-lg border border-ink-600 bg-ink-950 active:border-beat-400"
              >
                {blob ? (
                  <ClipThumbnail blob={blob} />
                ) : (
                  <span className="flex size-full items-center justify-center text-ink-400">
                    <PhotoIcon />
                  </span>
                )}
                <span className="tnum absolute bottom-1 left-1 rounded bg-ink-950/80 px-1 text-[10px] text-ink-200">
                  {formatDuration(clip.duration, i18n.language)}
                </span>
              </button>
              {/* Le nom du media aide a distinguer deux plans proches. */}
              <p className="mt-1 truncate text-[10px] text-ink-500">
                {assets[clip.assetId]?.name}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-ink-600 px-2 text-xs font-medium text-ink-200 active:bg-ink-800 disabled:opacity-60 [&>svg]:size-4"
    >
      {icon}
      {label}
    </button>
  );
}

/** Vignette d'un clip. `useObjectUrl` detient le cycle de vie de l'URL. */
function ClipThumbnail({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob);
  if (!url) return null;

  return blob.type.startsWith('video/') ? (
    <video src={url} muted playsInline preload="metadata" className="size-full object-cover" />
  ) : (
    <img src={url} alt="" draggable={false} className="size-full object-cover" />
  );
}
