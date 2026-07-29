/**
 * Panneau Media: import et bibliotheque.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { acceptAttribute } from './validateFile';
import { ReelImport } from './ReelImport';
import { importFiles } from './importMedia';
import { ColorImport } from './ColorImport';
import { OriginalAudioPrompt } from './OriginalAudioPrompt';
import { UrlImport } from './UrlImport';
import { useMedia } from '../preview/MediaProvider';
import { useProjectStore } from '../../store/useProjectStore';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import { useUiStore } from '../../store/useUiStore';
import { focalPointOf } from '../../engine/salience';
import { PhotoIcon, PlusIcon, TrashIcon, VideoIcon } from '../../components/ui/icons';
import { useLibrary } from './useLibrary';
import { forgetLibraryBlob, useLibraryBlobs } from './useLibraryBlobs';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useThumbnail } from './useThumbnail';
import { getMedia } from '../../storage/mediaStore';
import { isAssetUsed } from '../../domain/project';
import type { MediaAsset, MediaKind } from '../../domain/types';
import { formatDuration } from '../../lib/format';

/**
 * Grille de vignettes a nombre de colonnes VARIABLE.
 *
 * Un `grid-cols-3` fixe donnait des vignettes de 680 px sur un ecran large: une
 * seule rangee tenait dans le panneau, et la bibliotheque semblait ne contenir
 * que trois medias alors qu'ils etaient tous presents dans le DOM.
 *
 * `auto-fill` avec une largeur minimale conserve trois colonnes sur un
 * telephone de 390 px (le format de reference) et en ajoute au-dela, ce qui
 * borne la taille des vignettes quelle que soit la largeur.
 */
const THUMB_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2';

export function MediaSheet() {
  const { t, i18n } = useTranslation(['editor', 'errors', 'common']);

  const project = useProjectStore((state) => state.project);
  const addAssetToTimeline = useProjectStore((state) => state.addAssetToTimeline);
  const removeAsset = useProjectStore((state) => state.removeAsset);
  const addOriginalAudio = useProjectStore((state) => state.addOriginalAudio);
  const { register, blobs } = useMedia();
  const importPreferences = usePreferencesStore((state) => state.importPreferences);
  const pushToast = useUiStore((state) => state.pushToast);

  const library = useLibrary();

  const [importing, setImporting] = useState(false);
  /**
   * Videos sonores en attente de decision.
   *
   * Un etat local et non le store d'interface: la question ne survit pas a la
   * fermeture du panneau, et rien d'autre dans l'application n'a besoin de la
   * connaitre.
   */
  const [pendingAudio, setPendingAudio] = useState<MediaAsset[]>([]);
  /** Confirmation du vidage de la bibliotheque — geste irreversible. */
  const [confirmingClear, setConfirmingClear] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const isVisual = (asset: MediaAsset) => asset.kind === 'image' || asset.kind === 'video';
  const visualAssets = Object.values(project.assets).filter(isVisual);
  const libraryAssets = library.assets.filter(isVisual);

  /**
   * Blobs de « Mes medias », charges depuis le stockage si besoin.
   *
   * `MediaProvider.blobs` ne contient que les medias du projet COURANT et est
   * vide apres « Nouveau reel »: s'y fier laissait la bibliotheque sans aucune
   * vignette. Ce hook complete la liste en lisant les blobs manquants.
   */
  const libraryBlobs = useLibraryBlobs(libraryAssets, blobs);

  /**
   * Ajoute au montage un media venu de la bibliotheque.
   *
   * Son blob n'est pas forcement en memoire (bibliotheque chargee depuis
   * IndexedDB au demarrage, sans les donnees): on le relit avant d'enregistrer
   * le media, sinon la vignette et l'apercu resteraient vides.
   */
  const addFromLibrary = async (asset: MediaAsset) => {
    try {
      if (!blobs.has(asset.id)) {
        // Le blob est deja en cache si la vignette s'affiche: on evite une
        // seconde lecture d'IndexedDB dans le cas courant.
        const blob = libraryBlobs.get(asset.id) ?? (await getMedia(asset.storage));
        // Blob disparu du stockage: l'entree de bibliotheque est perimee.
        if (!blob) {
          forgetLibraryBlob(asset.id);
          await library.remove(asset.id);
          pushToast({ i18nKey: 'errors:import.corrupted', tone: 'error' });
          return;
        }
        await register(asset, blob);
      }
      const blob = blobs.get(asset.id);
      addAssetToTimeline(asset, { focal: blob ? await focalFor(asset, blob) : undefined });
    } catch {
      pushToast({ i18nKey: 'errors:storage.loadFailed', tone: 'error' });
    }
  };

  /**
   * Zone d'interet d'une image, seulement si le recentrage est demande.
   *
   * L'analyse est evitee quand l'option est eteinte: sur un lot de trente
   * photos, decoder chaque image pour un resultat inutilise serait du travail
   * pur. Les videos sont exclues — leur contenu change a chaque frame, donc un
   * point fixe mesure sur la premiere image n'aurait aucun sens sur la suite.
   */
  const focalFor = async (asset: MediaAsset, blob: Blob) => {
    if (!importPreferences.autoCenter || asset.kind !== 'image') return undefined;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(blob);
      return focalPointOf(bitmap) ?? undefined;
    } catch {
      // Image illisible par le decodeur: on retombe sur un cadrage centre plutot
      // que de faire echouer l'import pour un reglage de confort.
      return undefined;
    } finally {
      bitmap?.close();
    }
  };

  const handleFiles = async (files: FileList | null, accept: readonly MediaKind[]) => {
    if (!files || files.length === 0) return;

    setImporting(true);
    try {
      const { imported, failures } = await importFiles(Array.from(files), { accept });

      for (const { asset, blob } of imported) {
        await register(asset, blob);
        addAssetToTimeline(asset, { focal: await focalFor(asset, blob) });
        // Tout import rejoint aussi la bibliotheque personnelle: il restera
        // disponible pour un prochain reel, meme apres « Nouveau ».
        await library.add(asset);
      }

      // Chaque echec est signale individuellement: un fichier invalide au
      // milieu d'une selection ne doit pas rester silencieux.
      for (const failure of failures) {
        pushToast({ i18nKey: failure.i18nKey, params: failure.params, tone: 'error' });
      }

      /**
       * Videos SONORES: on demande si leur son doit servir au reel.
       *
       * La question est posee une seule fois pour tout le lot: enchainer six
       * dialogues apres l'import de six clips serait insupportable. La reponse
       * s'applique donc a l'ensemble — c'est presque toujours la meme intention.
       */
      const withSound = imported
        .map(({ asset }) => asset)
        .filter((asset) => asset.kind === 'video' && asset.hasAudio === true);
      if (withSound.length > 0) setPendingAudio(withSound);
    } finally {
      setImporting(false);
    }
  };

  /** Le son d'origine suit son plan: chaque piste demarre ou le clip est pose. */
  const acceptOriginalAudio = () => {
    const clips = useProjectStore.getState().project.videoTrack.clips;
    for (const asset of pendingAudio) {
      const clip = clips.find((candidate) => candidate.assetId === asset.id);
      addOriginalAudio(asset, { start: clip?.start ?? 0 });
    }
    setPendingAudio([]);
  };

  return (
    <div className="space-y-4 pt-1">
      <div className="grid grid-cols-2 gap-2">
        <ImportButton
          label={t('editor:media.importPhotos')}
          disabled={importing}
          onClick={() => photoInput.current?.click()}
        />
        <ImportButton
          label={t('editor:media.importVideos')}
          disabled={importing}
          onClick={() => videoInput.current?.click()}
        />
      </div>

      {/*
        Import d'un reel entier, distinct de l'import de videos au-dessus.

        Deux gestes differents: « Importer des videos » AJOUTE des plans au
        montage, « Importer un reel » le REMPLACE par un reel decoupe. Les
        confondre dans un meme bouton rendrait l'effet imprevisible.
      */}
      <ReelImport />

      <input
        ref={photoInput}
        type="file"
        accept={acceptAttribute(['image'])}
        multiple
        className="hidden"
        onChange={(event) => {
          void handleFiles(event.target.files, ['image']);
          // On vide la valeur: sinon reimporter le meme fichier ne declenche
          // aucun evenement `change`.
          event.target.value = '';
        }}
      />
      <input
        ref={videoInput}
        type="file"
        accept={acceptAttribute(['video'])}
        multiple
        className="hidden"
        onChange={(event) => {
          void handleFiles(event.target.files, ['video']);
          event.target.value = '';
        }}
      />

      {/* Les fonds unis sont des IMAGES generees: ils rejoignent le montage et la
          bibliotheque comme n'importe quelle photo. */}
      <ColorImport
        disabled={importing}
        onImported={async (asset, blob) => {
          await register(asset, blob);
          addAssetToTimeline(asset);
          await library.add(asset);
        }}
        onError={() => pushToast({ i18nKey: 'errors:import.decodeFailed', tone: 'error' })}
      />

      <UrlImport
        accept={['image', 'video']}
        onImported={(asset) => {
          addAssetToTimeline(asset);
          void library.add(asset);
        }}
      />

      {/*
        DEUX bibliotheques, distinguees par la couleur de leur contenant.

        « Ce reel » (bordure chartreuse) ne contient que les medias du montage en
        cours: ils disparaissent avec « Nouveau reel ». « Mes medias » (bordure
        neutre) persiste d'un reel a l'autre.

        La distinction est portee par la COULEUR DE BORDURE et non par le fond:
        les deux grilles doivent rester lisibles sous des vignettes tres
        colorees, et deux fonds differents rendraient la comparaison des images
        difficile.
      */}
      <section className="rounded-2xl border border-beat-400/35 bg-ink-850 p-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-beat-400">
            {t('editor:media.currentReel')}
          </h3>
          <span className="tnum text-[11px] text-ink-500">
            {t('common:unit.clipCount', { count: visualAssets.length })}
          </span>
        </div>

        {visualAssets.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-400">
            {t('editor:media.currentEmpty')}
          </p>
        ) : (
          // Colonnes variables: voir `THUMB_GRID`.
          <ul className={THUMB_GRID}>
            {visualAssets.map((asset) => (
              <MediaTile
                key={asset.id}
                asset={asset}
                blob={blobs.get(asset.id)}
                language={i18n.language}
                addLabel={t('editor:media.addToTimeline')}
                removeLabel={t('editor:media.removeAsset')}
                onAdd={() => addAssetToTimeline(asset)}
                onRemove={() => removeAsset(asset.id)}
                // Un media utilise dans le montage ne se supprime pas d'ici:
                // on retire d'abord le clip.
                removeDisabled={isAssetUsed(project, asset.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-ink-600 bg-ink-850 p-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-300">
            {t('editor:media.myMedia')}
          </h3>
          <span className="tnum text-[11px] text-ink-500">
            {t('common:unit.clipCount', { count: libraryAssets.length })}
          </span>
        </div>

        {/*
          « Tout effacer », en TETE de liste et non en pied.

          En pied, il tomberait juste sous la derniere vignette et se trouverait
          la ou le pouce vient de supprimer un media a l'unite — deux gestes de
          portee tres differente au meme endroit. En tete, il se lit comme une
          action sur la liste entiere, ce qu'il est.

          Masque quand la liste est vide: un bouton qui n'a rien a effacer.
        */}
        {library.assets.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            className="mb-2 min-h-11 w-full rounded-xl border border-danger-500 text-xs font-medium text-danger-500 active:bg-ink-800"
          >
            {t('editor:media.clearLibrary')}
          </button>
        )}

        {libraryAssets.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-400">{t('editor:media.empty')}</p>
        ) : (
          <ul className={THUMB_GRID}>
            {libraryAssets.map((asset) => (
              <MediaTile
                key={asset.id}
                asset={asset}
                // Les blobs de la bibliotheque viennent du hook dedie: ils
                // survivent a « Nouveau reel », contrairement a ceux du projet.
                blob={libraryBlobs.get(asset.id)}
                language={i18n.language}
                addLabel={t('editor:media.addToTimeline')}
                removeLabel={t('editor:media.removeFromLibrary')}
                onAdd={() => void addFromLibrary(asset)}
                onRemove={() => {
                  // Le cache de session doit oublier le media: sans cela, une
                  // reimportation ulterieure servirait un blob perime.
                  forgetLibraryBlob(asset.id);
                  void library.remove(asset.id);
                }}
                // Une vignette deja posee dans le montage porte un liseré: on
                // voit d'un coup d'oeil ce qui a servi.
                inProject={project.assets[asset.id] !== undefined}
              />
            ))}
          </ul>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
          {t('editor:media.myMediaHint')}
        </p>
      </section>

      <p className="pt-1 text-xs leading-relaxed text-ink-400">
        {t('common:privacy.explanation')}
      </p>

      {/* Refuser n'est pas destructif: le son reste dans le fichier importe, et
          l'onglet Audio permet de l'ajouter plus tard. */}
      <OriginalAudioPrompt
        assets={pendingAudio}
        onAccept={acceptOriginalAudio}
        onDecline={() => setPendingAudio([])}
      />

      {/*
        Confirmation: vider la bibliotheque ne s'annule pas.

        Le panneau Media n'a pas d'historique — contrairement au projet, dont
        chaque mutation passe par zundo. Un tap accidentel serait donc definitif,
        et c'est ce qui justifie la question la ou une suppression a l'unite s'en
        passe.

        La description rassure sur le seul vrai risque: les medias deja poses
        dans un montage ne bougent pas.
      */}
      <ConfirmDialog
        open={confirmingClear}
        title={t('editor:media.clearLibraryTitle')}
        description={t('editor:media.clearLibraryHint', {
          count: library.assets.length,
        })}
        confirmLabel={t('editor:media.clearLibraryConfirm')}
        cancelLabel={t('common:action.cancel')}
        onConfirm={() => {
          setConfirmingClear(false);
          // Le cache de session doit oublier les blobs: sans cela, une
          // reimportation ulterieure servirait une vignette perimee.
          library.assets.forEach((asset) => forgetLibraryBlob(asset.id));
          void library.clear();
        }}
        onCancel={() => setConfirmingClear(false)}
      />
    </div>
  );
}

/**
 * Une case de media, partagee par les deux bibliotheques.
 *
 * Le meme composant sert aux deux grilles: elles ne different que par leur
 * contenant et par l'action de suppression, ce qui garantit que les vignettes
 * se comportent identiquement des deux cotes.
 */
function MediaTile({
  asset,
  blob,
  language,
  addLabel,
  removeLabel,
  onAdd,
  onRemove,
  removeDisabled = false,
  inProject = false,
}: {
  asset: MediaAsset;
  blob: Blob | undefined;
  language: string;
  addLabel: string;
  removeLabel: string;
  onAdd: () => void;
  onRemove: () => void;
  removeDisabled?: boolean;
  inProject?: boolean;
}) {
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onAdd}
        aria-label={addLabel}
        // Fond plus sombre que le contenant: une vignette dont l'image n'est pas
        // encore decodee reste visible comme une case vide, au lieu de se fondre
        // dans le panneau.
        className={[
          'block aspect-square w-full overflow-hidden rounded-lg border bg-ink-950 active:border-beat-400',
          inProject ? 'border-beat-400/70' : 'border-ink-600',
        ].join(' ')}
      >
        {blob ? (
          <AssetThumbnail blob={blob} name={asset.name} kind={asset.kind} />
        ) : (
          <span className="flex size-full items-center justify-center text-ink-400 [&>svg]:size-5">
            {asset.kind === 'video' ? <VideoIcon /> : <PhotoIcon />}
          </span>
        )}
      </button>

      {asset.duration !== undefined && (
        <span className="tnum pointer-events-none absolute bottom-1 left-1 rounded bg-ink-950/80 px-1 text-[10px] text-ink-200">
          {formatDuration(asset.duration, language)}
        </span>
      )}

      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        disabled={removeDisabled}
        className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-md bg-ink-950/80 text-ink-200 disabled:opacity-0 [&>svg]:size-3.5"
      >
        <TrashIcon />
      </button>
    </li>
  );
}

function ImportButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-12 items-center justify-center gap-2 surface rounded-xl border border-ink-600 bg-ink-850 px-3 text-sm font-medium text-ink-50 active:bg-ink-800 disabled:opacity-60 [&>svg]:size-4"
    >
      <PlusIcon />
      {label}
    </button>
  );
}

/**
 * Vignette d'un blob, image ou video.
 *
 * Les videos passent par un decodage explicite d'une frame: un `<video>` seul
 * restait noir sur mobile tant que la lecture n'avait pas commence, et la liste
 * n'affichait que des cases vides.
 */
function AssetThumbnail({ blob, name, kind }: { blob: Blob; name: string; kind: MediaKind }) {
  const { url, loading } = useThumbnail(blob, kind);

  if (url) {
    return (
      <div className="relative size-full">
        {/* `alt` vide: le bouton parent porte deja le libelle. */}
        <img src={url} alt="" title={name} draggable={false} className="size-full object-cover" />
        {/* Pastille video: sans elle, une vignette extraite ne se distingue plus
            d'une photo une fois la frame decodee. */}
        {kind === 'video' && (
          <span
            aria-hidden="true"
            className="absolute left-1 top-1 flex size-5 items-center justify-center rounded bg-ink-950/75 text-media-400 [&>svg]:size-3"
          >
            <VideoIcon />
          </span>
        )}
      </div>
    );
  }

  return (
    <span
      className={[
        'flex size-full items-center justify-center text-ink-400 [&>svg]:size-5',
        // Le decodage d'une frame prend un instant: on le signale plutot que de
        // laisser une case vide qui ressemble a un echec.
        loading ? 'animate-pulse' : '',
      ].join(' ')}
    >
      {kind === 'video' ? <VideoIcon /> : <PhotoIcon />}
    </span>
  );
}
