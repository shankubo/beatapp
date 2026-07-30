/**
 * Studio audio: un ecran plein dedie au montage du son.
 *
 * Le panneau Audio suffit pour regler un volume ou poser une coupe rapide, mais
 * pas pour travailler le son: sur une feuille du bas, la forme d'onde tient
 * dans une centaine de pixels de haut, et chaque reglage repousse les suivants
 * hors de l'ecran. Ici l'onde occupe la place, et les operations de fichier —
 * extraire d'une video, ajouter une autre musique, exporter — trouvent enfin ou
 * se poser.
 *
 * L'editeur lui-meme n'est PAS reecrit: `AudioEditor` porte deja la forme
 * d'onde, la coupe et les bornes, et le dupliquer aurait ouvert deux verites
 * pour un meme montage. Cet ecran l'entoure.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AudioEditor } from './AudioEditor';
import {
  extractAudioFromVideo,
  audioNameFor,
  encodeAudioBuffer,
  pickAudioExportFormat,
} from './extractAudio';
import { renderTrack } from '../../export/audioMix';
import { acceptAttribute } from '../import/validateFile';
import { ImportError, importFile } from '../import/importMedia';
import { useMedia } from '../preview/MediaProvider';
import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import { IconButton } from '../../components/ui/IconButton';
import {
  CloseIcon,
  DownloadIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  VideoIcon,
} from '../../components/ui/icons';
import { musicTrack } from '../../domain/project';
import { formatDuration, formatRate } from '../../lib/format';
import { usePlaybackStore } from '../../store/usePlaybackStore';

export function AudioStudio({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation(['editor', 'common', 'errors', 'export']);

  const project = useProjectStore((state) => state.project);
  const setMusic = useProjectStore((state) => state.setMusic);
  const addOriginalAudio = useProjectStore((state) => state.addOriginalAudio);
  const removeAudioTrack = useProjectStore((state) => state.removeAudioTrack);

  const pushToast = useUiStore((state) => state.pushToast);
  const { register, audioBuffers, audioContext } = useMedia();

  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const setPlaying = usePlaybackStore((state) => state.setPlaying);
  const currentTime = usePlaybackStore((state) => state.time);
  const setTime = usePlaybackStore((state) => state.setTime);
  const rate = usePlaybackStore((state) => state.rate);
  const setRate = usePlaybackStore((state) => state.setRate);

  const [busy, setBusy] = useState<'import' | 'extract' | 'export' | null>(null);
  /** Piste en cours d'edition. `null` = la musique principale. */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const audioInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const tracks = project.audioTracks;
  const selected =
    tracks.find((track) => track.id === selectedId) ?? musicTrack(project) ?? tracks[0];
  const asset = selected ? project.assets[selected.assetId] : undefined;
  // Le buffer decode porte les vraies caracteristiques du son (canaux,
  // echantillonnage), que les metadonnees d'import ne conservent pas.
  const buffer = selected ? audioBuffers.get(selected.assetId) : undefined;

  // --- Ajouter une musique depuis un fichier audio.
  const handleAudioFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    void audioContext.resume();

    setBusy('import');
    try {
      const { asset: imported, blob } = await importFile(file, { accept: ['audio'] });
      await register(imported, blob);
      /*
        `addOriginalAudio` et non `setMusic` des qu'une musique existe:
        `setMusic` REMPLACE la piste musicale et efface l'analyse rythmique.
        Ajouter un second morceau ne doit pas defaire le calage du premier.
      */
      if (musicTrack(project)) {
        addOriginalAudio(imported, { start: 0 });
      } else {
        setMusic(imported);
      }
      setSelectedId(null);
    } catch (error) {
      pushToast({
        i18nKey: error instanceof ImportError ? error.i18nKey : 'errors:import.decodeFailed',
        tone: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  // --- Extraire la bande son d'une video.
  const handleVideoFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    void audioContext.resume();

    setBusy('extract');
    try {
      const extracted = await extractAudioFromVideo(file);
      // Le blob extrait repasse par le pipeline d'import normal: c'est lui qui
      // valide les magic bytes, sonde la duree et cree l'asset.
      const asAudio = new File([extracted], audioNameFor(file), { type: extracted.type });
      const { asset: imported, blob } = await importFile(asAudio, { accept: ['audio'] });
      await register(imported, blob);

      if (musicTrack(project)) {
        addOriginalAudio(imported, { start: 0 });
      } else {
        setMusic(imported);
      }
      setSelectedId(null);
    } catch (error) {
      pushToast({
        i18nKey: error instanceof ImportError ? error.i18nKey : 'errors:import.decodeFailed',
        tone: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  // --- Exporter la piste selectionnee en fichier.
  const handleExport = async () => {
    if (!selected || !asset) return;
    const buffer = audioBuffers.get(selected.assetId);
    if (!buffer) return;

    setBusy('export');
    try {
      const rendered = await renderTrack(selected, buffer);
      if (!rendered) {
        pushToast({ i18nKey: 'errors:audio.tooQuiet', tone: 'error' });
        return;
      }

      // Le format est choisi AVANT, pour que le nom du fichier porte la bonne
      // extension: un .m4a contenant du WebM ne s'ouvrirait nulle part.
      const format = await pickAudioExportFormat();
      const blob = await encodeAudioBuffer(rendered, format);

      /*
        Telechargement par ancre + `createObjectURL`.

        L'URL est revoquee juste apres: la garder retiendrait le blob entier en
        memoire, et un fichier audio de plusieurs minutes pese lourd sur un
        telephone.
      */
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = audioNameFor(asset, format.extension);
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      pushToast({ i18nKey: 'errors:audio.exportFailed', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const working = busy !== null;

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-ink-950">
      <header className="appbar-top flex shrink-0 items-center justify-between border-b border-ink-700 pl-4 pr-1">
        <h2 className="text-sm font-semibold text-ink-50">{t('editor:audio.studio')}</h2>
        <IconButton label={t('common:action.close')} onClick={onClose} size="sm">
          <CloseIcon />
        </IconButton>
      </header>

      <div className="scrollbar-none safe-pb min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* --- Sources --- */}
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
            {t('editor:audio.addSource')}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => audioInput.current?.click()}
              disabled={working}
              className="surface flex min-h-11 items-center justify-center gap-2 rounded-xl border border-ink-600 bg-ink-850 px-3 text-xs font-medium text-ink-100 active:bg-ink-800 disabled:opacity-60 [&>svg]:size-4"
            >
              <MusicIcon />
              {busy === 'import' ? t('common:state.loading') : t('editor:audio.fromFile')}
            </button>
            <button
              type="button"
              onClick={() => videoInput.current?.click()}
              disabled={working}
              className="surface flex min-h-11 items-center justify-center gap-2 rounded-xl border border-ink-600 bg-ink-850 px-3 text-xs font-medium text-ink-100 active:bg-ink-800 disabled:opacity-60 [&>svg]:size-4"
            >
              <VideoIcon />
              {busy === 'extract' ? t('common:state.loading') : t('editor:audio.fromVideo')}
            </button>
          </div>
          <p className="text-xs leading-relaxed text-ink-400">
            {t('editor:audio.fromVideoHint')}
          </p>
        </section>

        {/* --- Pistes du projet --- */}
        {tracks.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
              {t('editor:audio.tracks')}
            </h3>
            <ul className="space-y-1.5">
              {tracks.map((track) => {
                const trackAsset = project.assets[track.assetId];
                const active = track.id === selected?.id;
                return (
                  <li key={track.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedId(track.id)}
                      aria-pressed={active}
                      className={[
                        'surface flex min-h-11 flex-1 items-center gap-3 rounded-xl border px-3 text-left transition-colors',
                        active
                          ? 'border-audio-400/60 bg-audio-400/10'
                          : 'border-ink-600 bg-ink-850 active:bg-ink-800',
                      ].join(' ')}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-audio-400/15 text-audio-400 [&>svg]:size-4">
                        <MusicIcon />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink-50">
                          {trackAsset?.name ?? t('editor:audio.music')}
                        </span>
                        <span className="tnum block text-xs text-ink-400">
                          {formatDuration(trackAsset?.duration ?? 0, i18n.language)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAudioTrack(track.id)}
                      aria-label={t('common:action.delete')}
                      className="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-400 active:bg-ink-800 [&>svg]:size-4"
                    >
                      <CloseIcon />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* --- Informations de la piste --- */}
        {selected && asset && buffer && (
          <section className="space-y-1.5 rounded-xl border border-ink-700 bg-ink-850 p-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
              {t('editor:audio.info')}
            </h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <Info label={t('editor:audio.infoDuration')}
                value={formatDuration(buffer.duration, i18n.language)} />
              <Info label={t('editor:audio.infoChannels')}
                value={buffer.numberOfChannels > 1
                  ? t('editor:audio.infoStereo')
                  : t('editor:audio.infoMono')} />
              <Info label={t('editor:audio.infoRate')}
                value={`${Math.round(buffer.sampleRate / 1000)} kHz`} />
              <Info label={t('editor:audio.infoSize')}
                value={`${Math.round(asset.bytes / 1024)} Ko`} />
            </dl>
          </section>
        )}

        {/* --- Lecture --- */}
        {selected && asset && (
          <section className="flex items-center justify-center gap-2 rounded-xl border border-ink-700 bg-ink-850 p-2">
            <button
              type="button"
              onClick={() => setTime(Math.max(0, currentTime - 5))}
              aria-label={t('editor:transport.previousClip')}
              className="flex size-11 items-center justify-center rounded-lg text-ink-200 active:bg-ink-800 [&>svg]:size-4"
            >
              <SkipBackIcon />
            </button>
            <button
              type="button"
              onClick={() => {
                void audioContext.resume();
                setPlaying(!isPlaying);
              }}
              aria-label={isPlaying ? t('editor:audio.pauseSelection') : t('editor:audio.playSelection')}
              className="flex size-14 items-center justify-center rounded-full bg-audio-400/15 text-audio-400 active:bg-audio-400/25 [&>svg]:size-6"
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              type="button"
              onClick={() => setTime(currentTime + 5)}
              aria-label={t('editor:transport.nextClip')}
              className="flex size-11 items-center justify-center rounded-lg text-ink-200 active:bg-ink-800 [&>svg]:size-4"
            >
              <SkipForwardIcon />
            </button>

            {/* Vitesse: le meme cycle que l'apercu video, pour ne pas inventer
                un second vocabulaire. */}
            <button
              type="button"
              onClick={() => {
                const steps = [1, 0.5, 0.25, 2];
                const index = steps.indexOf(rate);
                setRate(steps[(index + 1) % steps.length] ?? 1);
              }}
              aria-label={t('editor:audio.speed')}
              className={[
                'tnum min-h-11 rounded-lg border px-2.5 text-xs font-semibold',
                rate === 1 ? 'border-ink-600 text-ink-300' : 'border-audio-400 text-audio-400',
              ].join(' ')}
            >
              {formatRate(rate, i18n.language)}
            </button>
          </section>
        )}

        {/* --- Montage de la piste selectionnee --- */}
        {selected && asset ? (
          <AudioEditor track={selected} asset={asset} />
        ) : (
          <p className="rounded-xl border border-dashed border-ink-600 p-4 text-center text-xs leading-relaxed text-ink-400">
            {t('editor:audio.studioEmpty')}
          </p>
        )}

        {/* --- Export --- */}
        {selected && asset && (
          <section className="space-y-2 border-t border-ink-700 pt-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
              {t('editor:audio.exportTitle')}
            </h3>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={working}
              className="surface flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-audio-400 px-3 text-sm font-bold text-ink-950 active:bg-audio-500 disabled:opacity-60 [&>svg]:size-4"
            >
              <DownloadIcon />
              {busy === 'export' ? t('common:state.loading') : t('editor:audio.exportAction')}
            </button>
            {/*
              Le format est ANNONCE, pas devine.

              Mesure dans le navigateur: `AudioEncoder` refuse `mp3` — aucun
              moteur n'embarque d'encodeur MP3. Le dire evite de chercher une
              option qui n'existera jamais.
            */}
            <p className="text-xs leading-relaxed text-ink-400">
              {t('editor:audio.exportHint')}
            </p>
          </section>
        )}
      </div>

      <input
        ref={audioInput}
        type="file"
        accept={acceptAttribute(['audio'])}
        className="hidden"
        onChange={(event) => {
          void handleAudioFile(event.target.files);
          // Sans cette remise a zero, reimporter le meme fichier ne declenche
          // aucun evenement `change`.
          event.target.value = '';
        }}
      />
      <input
        ref={videoInput}
        type="file"
        accept={acceptAttribute(['video'])}
        className="hidden"
        onChange={(event) => {
          void handleVideoFile(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}

/** Une ligne du tableau d'informations. */
function Info({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-400">{label}</dt>
      <dd className="tnum text-right text-ink-100">{value}</dd>
    </>
  );
}
