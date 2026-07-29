import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { InfoIcon, PlusIcon, SettingsIcon } from '../../components/ui/icons';
import { SUPPORTED_LANGUAGES, setLanguage, type Language } from '../../i18n';
import { videoDuration } from '../../domain/timeline';
import { isProjectEmpty } from '../onboarding/onboardingState';
import { useNewProject } from './useNewProject';

export function AppBar({ translucent = false }: { translucent?: boolean } = {}) {
  const { t, i18n } = useTranslation(['editor', 'export', 'common', 'settings', 'about']);

  const project = useProjectStore((state) => state.project);
  const renameProject = useProjectStore((state) => state.renameProject);
  const setExportOpen = useUiStore((state) => state.setExportOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const setAboutOpen = useUiStore((state) => state.setAboutOpen);

  const [editingName, setEditingName] = useState(false);
  const [confirmingNew, setConfirmingNew] = useState(false);
  const { startNewProject } = useNewProject();

  const canExport = videoDuration(project.videoTrack) > 0;
  // Un projet vierge n'a rien a effacer: la confirmation serait un obstacle
  // inutile, on repart directement.
  const hasContent = !isProjectEmpty(project);

  const currentLanguage = (i18n.resolvedLanguage ?? 'fr') as Language;
  const nextLanguage =
    SUPPORTED_LANGUAGES[
      (SUPPORTED_LANGUAGES.indexOf(currentLanguage) + 1) % SUPPORTED_LANGUAGES.length
    ]!;

  return (
    <header
      className={[
        'safe-pt flex h-appbar shrink-0 items-center gap-2 px-3',
        translucent
          ? // Voile sombre plutot que transparence pure: sur une image claire,
            // du texte ink-50 sans fond passe sous le seuil de contraste de
            // 4,5:1 que le projet s'impose.
            'border-b border-ink-700/50 bg-ink-950/70 backdrop-blur-sm'
          : 'border-b border-ink-700',
      ].join(' ')}
    >
      {editingName ? (
        <input
          autoFocus
          value={project.name}
          onChange={(event) => renameProject(event.target.value)}
          onBlur={() => setEditingName(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') setEditingName(false);
          }}
          aria-label={t('editor:project.rename')}
          placeholder={t('editor:project.namePlaceholder')}
          className="min-w-0 flex-1 rounded-lg bg-ink-850 px-2 py-1.5 text-sm text-ink-50 outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditingName(true)}
          aria-label={t('editor:project.rename')}
          className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-ink-50"
        >
          {/* Nom saisi par l'utilisateur: rendu comme du texte, jamais interprete. */}
          {project.name}
        </button>
      )}

      <button
        type="button"
        onClick={() => (hasContent ? setConfirmingNew(true) : void startNewProject())}
        aria-label={t('editor:project.new')}
        className="surface flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-ink-600 bg-ink-850 px-2.5 text-xs font-semibold text-ink-200 active:bg-ink-800 [&>svg]:size-3.5"
      >
        <PlusIcon />
        {t('editor:project.newShort')}
      </button>

      <button
        type="button"
        onClick={() => void setLanguage(nextLanguage)}
        aria-label={t('common:language.label')}
        className="surface min-h-9 shrink-0 rounded-lg border border-ink-600 bg-ink-850 px-2.5 text-xs font-semibold uppercase text-ink-300 active:bg-ink-800"
      >
        {currentLanguage}
      </button>

      {/* « A propos » juste avant les reglages: deux entrees de meme nature —
          ce qui decrit et ce qui configure — gagnent a se suivre. */}
      <button
        type="button"
        onClick={() => setAboutOpen(true)}
        aria-label={t('about:open')}
        className="surface flex min-h-9 shrink-0 items-center rounded-lg border border-ink-600 bg-ink-850 px-2 text-ink-300 active:bg-ink-800 [&>svg]:size-4"
      >
        <InfoIcon />
      </button>

      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        aria-label={t('settings:open')}
        className="surface flex min-h-9 shrink-0 items-center rounded-lg border border-ink-600 bg-ink-850 px-2 text-ink-300 active:bg-ink-800 [&>svg]:size-4"
      >
        <SettingsIcon />
      </button>

      <button
        type="button"
        onClick={() => setExportOpen(true)}
        disabled={!canExport}
        className="surface min-h-9 shrink-0 rounded-lg bg-beat-400 px-3.5 text-xs font-bold text-ink-950 active:bg-beat-500 disabled:opacity-60"
      >
        {t('export:cta')}
      </button>

      <ConfirmDialog
        open={confirmingNew}
        title={t('editor:project.newConfirmTitle')}
        description={t('editor:project.newConfirmBody')}
        confirmLabel={t('editor:project.newConfirm')}
        cancelLabel={t('common:action.cancel')}
        onCancel={() => setConfirmingNew(false)}
        onConfirm={() => {
          setConfirmingNew(false);
          void startNewProject();
        }}
      />
    </header>
  );
}
