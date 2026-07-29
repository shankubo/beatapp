/**
 * Import d'un reel existant, avec choix de la methode de decoupage.
 *
 * Le choix est pose AVANT l'import et non apres: l'analyse dure plusieurs
 * secondes, et demander la methode une fois le fichier lu obligerait a attendre
 * deux fois si l'utilisateur change d'avis.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Segmented } from '../../components/ui/Segmented';
import { acceptAttribute } from './validateFile';
import { useImportReel, type ReelCutMethod } from './useImportReel';
import { useProjectStore } from '../../store/useProjectStore';
import { isProjectEmpty } from '../onboarding/onboardingState';
import { VideoIcon } from '../../components/ui/icons';

export function ReelImport({ onImported }: { onImported?: () => void } = {}) {
  const { t } = useTranslation(['editor', 'common']);
  const input = useRef<HTMLInputElement>(null);
  const [method, setMethod] = useState<ReelCutMethod>('beat');
  const { importReel, stage } = useImportReel();

  const project = useProjectStore((state) => state.project);
  const willReplace = !isProjectEmpty(project);
  const busy = stage !== null;

  const stageLabel =
    stage === 'importing'
      ? t('editor:media.reelImporting')
      : stage === 'analyzing'
        ? t('editor:media.reelAnalyzing')
        : stage === 'cutting'
          ? t('editor:media.reelCutting')
          : null;

  return (
    <section className="space-y-2 rounded-xl border border-media-400/35 bg-ink-850 p-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-media-400">
        {t('editor:media.importReel')}
      </h3>
      <p className="text-xs leading-relaxed text-ink-400">{t('editor:media.reelHint')}</p>

      <Segmented
        label={t('editor:media.reelMethod')}
        options={[
          { value: 'beat' as const, label: t('editor:media.reelMethodBeat') },
          { value: 'scene' as const, label: t('editor:media.reelMethodScene') },
        ]}
        value={method}
        onChange={setMethod}
      />
      <p className="text-[11px] leading-snug text-ink-400">
        {t(
          method === 'beat'
            ? 'editor:media.reelMethodBeatHint'
            : 'editor:media.reelMethodSceneHint',
        )}
      </p>

      {/* Le remplacement est annonce AVANT: un montage en cours efface sans
          prevenir serait une perte, meme si « Annuler » la rattrape. */}
      {willReplace && (
        <p className="text-[11px] leading-snug text-ink-300">
          {t('editor:media.reelReplaceWarn')}
        </p>
      )}

      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="surface flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-ink-600 bg-ink-900 text-sm font-medium text-ink-100 active:bg-ink-800 disabled:opacity-60 [&>svg]:size-4"
      >
        <VideoIcon />
        {stageLabel ?? t('editor:media.importReel')}
      </button>

      <p className="text-[11px] leading-snug text-ink-400">
        {t('editor:media.reelSocialNote')}
      </p>

      <input
        ref={input}
        type="file"
        accept={acceptAttribute(['video'])}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Remise a zero avant l'await: sans elle, reimporter le meme fichier
          // ne declenche aucun evenement `change`.
          event.target.value = '';
          if (file) void importReel(file, method).then(() => onImported?.());
        }}
      />
    </section>
  );
}
