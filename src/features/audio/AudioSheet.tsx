/**
 * Panneau Audio: musique, samples generes, reglages de piste.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { acceptAttribute } from '../import/validateFile';
import { ImportError, importFile } from '../import/importMedia';
import { UrlImport } from '../import/UrlImport';
import { AudioEditor } from './AudioEditor';
import { useMedia } from '../preview/MediaProvider';
import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import { Slider } from '../../components/ui/Slider';
import {
  MusicIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  VideoIcon,
} from '../../components/ui/icons';
import { musicTrack } from '../../domain/project';
import { GENERATED_SAMPLES, findGeneratedSample } from '../samples/sampleGen';
import { useGeneratedSample } from '../samples/useGeneratedSample';
import { useSamplePreview } from '../samples/useSamplePreview';
import { useLibrary } from '../import/useLibrary';
import { formatDuration, formatPercent } from '../../lib/format';

export function AudioSheet() {
  const { t, i18n } = useTranslation(['editor', 'errors', 'samples']);

  const project = useProjectStore((state) => state.project);
  const setMusic = useProjectStore((state) => state.setMusic);
  const updateAudioTrack = useProjectStore((state) => state.updateAudioTrack);
  const removeAudioTrack = useProjectStore((state) => state.removeAudioTrack);

  const { register } = useMedia();
  const pushToast = useUiStore((state) => state.pushToast);
  const setAudioStudioOpen = useUiStore((state) => state.setAudioStudioOpen);
  const { applyGeneratedSample } = useGeneratedSample();
  const { playingId, toggle, stop: stopPreview } = useSamplePreview();
  const library = useLibrary();

  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const track = musicTrack(project);

  const handleImport = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    setBusy(true);
    try {
      const { asset, blob } = await importFile(file, { accept: ['audio'] });
      await register(asset, blob);
      setMusic(asset);
      // La musique rejoint la bibliotheque personnelle: elle restera disponible
      // pour un prochain reel. On passe par le store et non par le stockage
      // directement, sinon la liste en memoire ne serait pas mise a jour et la
      // piste n'apparaitrait dans « Mes medias » qu'apres un rechargement.
      await library.add(asset);
    } catch (error) {
      pushToast({
        i18nKey: error instanceof ImportError ? error.i18nKey : 'errors:import.decodeFailed',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  /** Ajoute une boucle generee. Le rendu et le stockage vivent dans le hook. */
  const handleGeneratedSample = async (sampleId: string) => {
    // L'ecoute s'arrete AVANT d'appliquer: sans cela, la boucle auditionnee
    // continuerait par-dessus la musique qu'on vient de poser, et les deux se
    // superposeraient sans qu'aucun bouton ne permette d'arreter la premiere.
    stopPreview();
    setBusy(true);
    try {
      await applyGeneratedSample(sampleId);
    } catch {
      pushToast({ i18nKey: 'errors:audio.decodeFailed', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const asset = track ? project.assets[track.assetId] : undefined;

  /**
   * Sons d'origine des videos, une piste par video.
   *
   * Listes a part de la musique: ils n'ont ni analyse rythmique ni decoupage a
   * regler, seulement un volume et une suppression. Les melanger a la piste
   * musicale dans une liste unique aurait fait croire qu'on peut analyser le
   * rythme d'un bruit d'ambiance.
   */
  const originalTracks = project.audioTracks.filter((t) => t.role === 'original');

  return (
    <div className="space-y-5 pt-1">
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={busy}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-ink-600 px-3 text-sm font-medium text-ink-50 active:bg-ink-800 disabled:opacity-60 [&>svg]:size-4"
      >
        <PlusIcon />
        {t('editor:audio.import')}
      </button>

      {/*
        Entree du studio, visible MEME sans piste.

        Elle n'existait qu'au bas de l'editeur de forme d'onde, donc uniquement
        une fois une musique posee. Or « extraire le son d'une video » sert
        justement a obtenir sa PREMIERE piste: le chemin le plus utile etait le
        seul inatteignable.
      */}
      <button
        type="button"
        onClick={() => setAudioStudioOpen(true)}
        className="surface flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-ink-600 text-xs font-medium text-ink-200 active:bg-ink-850 [&>svg]:size-4"
      >
        <VideoIcon />
        {t('editor:audio.studioOpen')}
      </button>

      <input
        ref={fileInput}
        type="file"
        accept={acceptAttribute(['audio'])}
        className="hidden"
        onChange={(event) => {
          void handleImport(event.target.files);
          event.target.value = '';
        }}
      />

      {track && asset ? (
        <section className="space-y-1 rounded-xl border border-ink-600 bg-ink-850 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-50">
                {/* Un sample genere porte un nom traduit; un import garde son
                    nom de fichier, affiche comme du texte brut. */}
                {generatedName(asset.sampleId, t) ?? asset.name}
              </p>
              {asset.duration !== undefined && (
                <p className="tnum text-xs text-ink-400">
                  {formatDuration(asset.duration, i18n.language)}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => removeAudioTrack(track.id)}
              aria-label={t('editor:audio.remove')}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-400 active:bg-ink-800 [&>svg]:size-4"
            >
              <TrashIcon />
            </button>
          </div>

          <Slider
            label={t('editor:audio.gain')}
            value={track.gain}
            min={0}
            max={1.5}
            onChange={(gain) => updateAudioTrack(track.id, { gain })}
            displayValue={formatPercent(track.gain / 1.5, i18n.language)}
          />
          <Slider
            label={t('editor:audio.fadeIn')}
            value={track.fadeIn}
            min={0}
            max={4}
            step={0.1}
            onChange={(fadeIn) => updateAudioTrack(track.id, { fadeIn })}
            displayValue={formatDuration(track.fadeIn, i18n.language)}
          />
          <Slider
            label={t('editor:audio.fadeOut')}
            value={track.fadeOut}
            min={0}
            max={4}
            step={0.1}
            onChange={(fadeOut) => updateAudioTrack(track.id, { fadeOut })}
            displayValue={formatDuration(track.fadeOut, i18n.language)}
          />
        </section>
      ) : (
        <p className="text-center text-sm text-ink-400">{t('editor:audio.emptyHint')}</p>
      )}

      {/*
        Sons d'origine des videos. Une section par piste: volume et suppression,
        rien de plus — il n'y a ni rythme a analyser ni extrait a choisir dans un
        bruit d'ambiance.
      */}
      {originalTracks.map((original) => {
        const originalAsset = project.assets[original.assetId];
        return (
          <section
            key={original.id}
            className="rounded-xl border border-ink-600 bg-ink-850 p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-audio-400/15 text-audio-400 [&>svg]:size-4">
                <MusicIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium uppercase tracking-wide text-ink-300">
                  {t('editor:originalAudio.track')}
                </span>
                {/* Le nom du fichier identifie la video quand plusieurs plans
                    sonores coexistent. */}
                <span className="block truncate text-[11px] text-ink-400">
                  {originalAsset?.name ?? ''}
                </span>
              </span>
              <button
                type="button"
                onClick={() => removeAudioTrack(original.id)}
                aria-label={t('editor:originalAudio.remove')}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-danger-500 active:bg-ink-800 [&>svg]:size-4"
              >
                <TrashIcon />
              </button>
            </div>

            <Slider
              label={t('editor:audio.gain')}
              value={original.gain}
              min={0}
              max={1.5}
              onChange={(gain) => updateAudioTrack(original.id, { gain })}
              displayValue={formatPercent(original.gain / 1.5, i18n.language)}
            />
          </section>
        );
      })}

      {/*
        L'editeur vient apres les reglages de niveau: on regle d'abord ce qui
        s'entend, on decoupe ensuite.

        Il etait replie dans un `<details>` ferme, et le decoupage audio passait
        pour absent: rien n'indiquait qu'une forme d'onde, des bornes et une
        fonction de coupe se trouvaient derriere ce titre. Il est desormais
        deplie — c'est la raison meme d'ouvrir l'onglet Audio une fois la
        musique posee.
      */}
      {track && asset && (
        <section className="rounded-xl border border-audio-400/35 bg-ink-850 p-3">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-audio-400">
            {t('editor:audio.edit')}
          </h3>
          <AudioEditor track={track} asset={asset} />

        </section>
      )}

      <UrlImport accept={['audio']} onImported={setMusic} />

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">
          {t('editor:samples.generated')}
        </h3>
        {/*
          Deux boutons par ligne, et non un seul.

          Ecouter et choisir sont deux intentions distinctes: jusqu'ici, entendre
          une boucle exigeait de l'APPLIQUER, donc d'ecraser la musique en place,
          puis de recommencer pour la suivante. Le bouton d'ecoute est pose a
          gauche, la ou se trouvait l'icone decorative — il occupe donc la place
          d'un element qui ne servait a rien.
        */}
        <ul className="space-y-2">
          {GENERATED_SAMPLES.map((sample) => {
            const previewing = playingId === sample.id;
            return (
              <li
                key={sample.id}
                className="flex items-center gap-2 rounded-xl border border-ink-600 bg-ink-850 p-2"
              >
                <button
                  type="button"
                  onClick={() => toggle(sample.id)}
                  aria-label={t(previewing ? 'editor:samples.stopPreview' : 'editor:samples.preview')}
                  aria-pressed={previewing}
                  className={[
                    'flex size-11 shrink-0 items-center justify-center rounded-lg [&>svg]:size-4',
                    previewing
                      ? 'bg-audio-400 text-ink-950'
                      : 'bg-ink-800 text-audio-400 active:bg-ink-700',
                  ].join(' ')}
                >
                  {previewing ? <PauseIcon /> : <PlayIcon />}
                </button>

                <button
                  type="button"
                  onClick={() => void handleGeneratedSample(sample.id)}
                  disabled={busy}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-50">
                      {t(sample.nameKey)}
                    </span>
                    <span className="block truncate text-xs text-ink-400">
                      {t(sample.descriptionKey)}
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-xs font-medium text-beat-400">
                    {sample.bpm}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-xs leading-relaxed text-ink-400">{t('editor:audio.trendingNote')}</p>
    </div>
  );
}

/**
 * Nom traduit d'une boucle generee, ou `null` si le media est un import.
 * On passe par la cle typee portee par le catalogue, jamais par une cle
 * assemblee a la volee.
 */
function generatedName(
  sampleId: string | undefined,
  t: ReturnType<typeof useTranslation<['editor', 'errors', 'samples']>>['t'],
): string | null {
  if (!sampleId) return null;
  const sample = findGeneratedSample(sampleId);
  return sample ? t(sample.nameKey) : null;
}
