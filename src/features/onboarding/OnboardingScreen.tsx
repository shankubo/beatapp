/**
 * Ecran de demarrage: du projet vide au montage rythme en trois taps.
 *
 * Chaque carte declenche une operation et se coche quand elle est accomplie.
 * La carte 3 enchaine l'analyse du rythme ET la repartition des plans: c'est le
 * coeur de la promesse — l'utilisateur n'a pas a comprendre que ce sont deux
 * operations distinctes.
 *
 * Sur echec, l'ecran RESTE ouvert. Fermer deposerait l'utilisateur dans un
 * editeur inchange sans explication, le message d'erreur etant son seul indice.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StepCard } from './StepCard';
import { deriveSteps, type BusyStep } from './onboardingState';
import { acceptAttribute } from '../import/validateFile';
import { importFile, importFiles } from '../import/importMedia';
import { useLibrary } from '../import/useLibrary';
import { useMedia } from '../preview/MediaProvider';
import { useGeneratedSample } from '../samples/useGeneratedSample';
import { GENERATED_SAMPLES } from '../samples/sampleGen';
import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import { analyzeAudio } from '../../audio/beatClient';
import { musicTrack } from '../../domain/project';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  MusicIcon,
  PlusIcon,
  SparkIcon,
} from '../../components/ui/icons';
import { ReelImport } from '../import/ReelImport';
import { formatInteger } from '../../lib/format';
import type { MediaKind } from '../../domain/types';

export function OnboardingScreen({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation(['editor', 'common', 'errors', 'samples']);

  const project = useProjectStore((state) => state.project);
  const addAssetToTimeline = useProjectStore((state) => state.addAssetToTimeline);
  const setMusic = useProjectStore((state) => state.setMusic);
  const setBeatMap = useProjectStore((state) => state.setBeatMap);
  const distributeOnBeats = useProjectStore((state) => state.distributeOnBeats);

  const pushToast = useUiStore((state) => state.pushToast);
  const setTemplatesOpen = useUiStore((state) => state.setTemplatesOpen);
  const { register, audioContext, audioBuffers } = useMedia();
  const { applyGeneratedSample } = useGeneratedSample();
  const library = useLibrary();

  const [busy, setBusy] = useState<BusyStep | null>(null);
  const [showLoops, setShowLoops] = useState(false);
  /*
    Chemins paralleles replies par defaut.

    Etat LOCAL et non dans `useUiStore`: le parcours en trois etapes doit
    reprendre la main a chaque ouverture. Memorise, le panneau se rouvrirait
    deplie des jours plus tard, en tete de ce qui est justement l'ecran des
    premiers pas.
  */
  const [showOther, setShowOther] = useState(false);

  const mediaInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  const steps = deriveSteps(project, busy);
  const clipCount = project.videoTrack.clips.length;
  const beatMap = project.beatMap;

  // --- Etape 1: images et videos.
  const handleMedia = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setBusy('media');
    try {
      const accept: readonly MediaKind[] = ['image', 'video'];
      const { imported, failures } = await importFiles(Array.from(files), { accept });

      for (const { asset, blob } of imported) {
        await register(asset, blob);
        addAssetToTimeline(asset);
        await library.add(asset);
      }

      // Chaque echec est signale: un fichier invalide au milieu d'une selection
      // ne doit pas rester silencieux.
      for (const failure of failures) {
        pushToast({ i18nKey: failure.i18nKey, params: failure.params, tone: 'error' });
      }
    } finally {
      setBusy(null);
    }
  };

  // --- Etape 2: musique, par fichier ou par boucle generee.
  const handleAudioFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    // Le clic est un geste utilisateur: c'est le moment ou jamais de reveiller
    // le contexte audio, cree suspendu au demarrage. Sans cela, la lecture
    // serait muette une fois dans l'editeur.
    void audioContext.resume();

    setBusy('audio');
    try {
      const { asset, blob } = await importFile(file, { accept: ['audio'] });
      await register(asset, blob);
      setMusic(asset);
      await library.add(asset);
    } catch {
      pushToast({ i18nKey: 'errors:import.decodeFailed', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handleLoop = async (sampleId: string) => {
    void audioContext.resume();

    setBusy('audio');
    try {
      await applyGeneratedSample(sampleId);
      setShowLoops(false);
    } catch {
      pushToast({ i18nKey: 'errors:audio.decodeFailed', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  // --- Etape 3: analyse du rythme, puis repartition des plans.
  const handleBeat = async () => {
    const track = musicTrack(project);
    // Le buffer est lu ICI et non capture plus tot: `register` alimente un etat
    // React, donc la Map d'une closure anterieure serait perimee.
    const buffer = track ? audioBuffers.get(track.assetId) : undefined;
    if (!track || !buffer) return;

    // Sans plan, la repartition ne ferait rien: on le dit plutot que de laisser
    // croire a une panne.
    if (clipCount === 0) {
      pushToast({ i18nKey: 'editor:onboarding.needMedia', tone: 'error' });
      return;
    }

    void audioContext.resume();

    setBusy('beat');
    try {
      const result = await analyzeAudio(track.assetId, buffer);
      if (result.beats.length === 0) {
        pushToast({ i18nKey: 'errors:audio.tooQuiet', tone: 'error' });
        return;
      }
      setBeatMap(result);
      // Enveloppe indispensable: passer la reference nue transmettrait
      // l'evenement de clic comme options.
      distributeOnBeats();
      onClose();
    } catch {
      pushToast({ i18nKey: 'errors:audio.analysisFailed', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const working = busy !== null;

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-ink-950">
      <header className="safe-pt flex h-appbar shrink-0 items-center justify-between border-b border-ink-700 px-4">
        <h2 className="text-sm font-semibold text-ink-50">{t('editor:onboarding.title')}</h2>
        {/* Pendant une operation, « Passer » disparait: un resultat qui
            atterrirait sur un editeur deja quitte serait deroutant. */}
        {!working && (
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 rounded-lg border border-ink-600 px-3 text-xs font-semibold text-ink-200 active:bg-ink-800"
          >
            {t('editor:onboarding.skip')}
          </button>
        )}
      </header>

      <div className="scrollbar-none safe-pb min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <p className="text-sm leading-relaxed text-ink-400">{t('editor:onboarding.intro')}</p>

        <StepCard
          number={t('editor:onboarding.step1.number')}
          label={t('editor:onboarding.step1.label')}
          detail={
            steps.media === 'busy'
              ? t('common:state.loading')
              : clipCount > 0
                ? t('editor:onboarding.step1.done', { count: clipCount })
                : t('editor:onboarding.step1.hint')
          }
          state={working && busy !== 'media' ? 'disabled' : steps.media}
          tone="media"
          onClick={() => mediaInput.current?.click()}
        />

        <StepCard
          number={t('editor:onboarding.step2.number')}
          label={t('editor:onboarding.step2.label')}
          detail={
            steps.audio === 'busy'
              ? t('common:state.loading')
              : t('editor:onboarding.step2.hint')
          }
          state={working && busy !== 'audio' ? 'disabled' : steps.audio}
          tone="audio"
          onClick={() => audioInput.current?.click()}
        />

        <div>
          <button
            type="button"
            onClick={() => setShowLoops((open) => !open)}
            disabled={working}
            aria-expanded={showLoops}
            className="min-h-11 w-full rounded-xl border border-dashed border-ink-600 text-xs font-medium text-audio-400 active:bg-ink-850 disabled:opacity-60"
          >
            {t('editor:onboarding.step2.orGenerated')}
          </button>

          {showLoops && (
            <ul className="space-y-2 pt-1">
              {GENERATED_SAMPLES.map((sample) => (
                <li key={sample.id}>
                  <button
                    type="button"
                    onClick={() => void handleLoop(sample.id)}
                    disabled={working}
                    className="surface flex w-full items-center gap-3 rounded-xl border border-ink-600 bg-ink-850 p-3 text-left active:bg-ink-800 disabled:opacity-60"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-audio-400/15 text-audio-400 [&>svg]:size-4">
                      <MusicIcon />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-50">
                        {t(sample.nameKey)}
                      </span>
                      <span className="block truncate text-xs text-ink-400">
                        {t(sample.descriptionKey)}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-xs font-medium text-ink-400">
                      {formatInteger(sample.bpm, i18n.language)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <StepCard
          number={t('editor:onboarding.step3.number')}
          label={t('editor:onboarding.step3.label')}
          detail={
            steps.beat === 'busy'
              ? t('common:state.analyzing')
              : beatMap
                ? t('editor:onboarding.step3.done', {
                    bpm: formatInteger(Math.round(beatMap.bpm), i18n.language),
                  })
                : t('editor:onboarding.step3.hint')
          }
          state={working && busy !== 'beat' ? 'disabled' : steps.beat}
          tone="beat"
          onClick={() => void handleBeat()}
        />

        {/*
          SEPARATION entre le parcours en trois etapes et les chemins paralleles.

          Sans elle, l'import d'un reel et les modeles se lisaient comme une
          suite du parcours — une etape 4 et une etape 5. Or ils ne s'y inserent
          pas: ils le REMPLACENT. Le « ou » le dit en un mot, la ou aucune
          formulation dans les cartes ne pouvait le faire.
        */}
        <div className="flex items-center gap-3 pt-1" aria-hidden="true">
          <span className="h-px flex-1 bg-ink-700" />
          <span className="text-xs text-ink-400">{t('editor:onboarding.or')}</span>
          <span className="h-px flex-1 bg-ink-700" />
        </div>

        {/*
          Les deux chemins paralleles, REPLIES derriere une seule entree.

          Deplies en permanence, ils occupaient plus de place que les trois
          etapes qu'ils accompagnent — le bloc d'import d'un reel porte a lui
          seul un titre, une aide et un selecteur de methode. Replies, la page
          se lit d'un regard et le parcours principal reprend le dessus.

          Un depliage sur place plutot qu'une feuille par-dessus: l'ecran est
          deja modal, et empiler une seconde couche a fermer sur la premiere
          serait une sortie de plus a trouver.
        */}
        <div>
          <button
            type="button"
            onClick={() => setShowOther((open) => !open)}
            disabled={working}
            aria-expanded={showOther}
            className="surface flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-ink-600 text-xs font-medium text-ink-200 active:bg-ink-850 disabled:opacity-60 [&>svg]:size-4"
          >
            <PlusIcon />
            {t('editor:onboarding.other')}
            {showOther ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </button>

          {showOther && (
            <div className="space-y-3 pt-3">
              {/*
                Import d'un reel: il remplace les trois etapes d'un coup, un reel
                arrivant avec ses images, son son et ses coupes.
              */}
              <ReelImport onImported={onClose} />

              {/*
                Modeles: ils posent des REGLAGES sur un montage et ne fabriquent
                pas un reel a eux seuls. D'ou leur place apres l'import, qui lui
                apporte de la matiere.
              */}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  setTemplatesOpen(true);
                }}
                disabled={working}
                className="surface flex w-full items-center gap-3 rounded-xl border border-ink-600 bg-ink-850 p-3 text-left active:bg-ink-800 disabled:opacity-60"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-beat-400/15 text-beat-400 [&>svg]:size-4">
                  <SparkIcon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-50">
                    {t('samples:templates.open')}
                  </span>
                  <span className="block text-xs leading-relaxed text-ink-400">
                    {t('editor:onboarding.templateHint')}
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Logo promotionnel: transition en fondu depuis le fond sombre vers la
            zone claire de l'image, evitant la coupure brutale blanc/noir. */}
        <div className="-mx-4 h-6 bg-gradient-to-b from-ink-950 to-white" />
        <div className="-mx-4 flex justify-center bg-white pb-4">
          <img
            src="/icons/logo_text.png"
            alt=""
            aria-hidden="true"
            className="w-full max-w-sm object-contain"
          />
        </div>
      </div>

      {/* Les champs de fichier sont caches: les cartes servent de declencheur. */}
      <input
        ref={mediaInput}
        type="file"
        accept={acceptAttribute(['image', 'video'])}
        multiple
        className="hidden"
        onChange={(event) => {
          void handleMedia(event.target.files);
          // Sans cette remise a zero, reimporter le meme fichier ne declenche
          // aucun evenement `change`.
          event.target.value = '';
        }}
      />
      <input
        ref={audioInput}
        type="file"
        accept={acceptAttribute(['audio'])}
        className="hidden"
        onChange={(event) => {
          void handleAudioFile(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
