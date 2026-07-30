/**
 * Menu principal: tout ce que fait l'application, en une seule liste.
 *
 * Pourquoi un menu alors qu'il existe deja un rail d'outils: le rail est le
 * chemin RAPIDE pendant le montage — six icones, un geste. Le menu est le
 * chemin EXHAUSTIF, celui qu'on ouvre quand on cherche quelque chose sans
 * savoir ou c'est. Les deux se doublent volontairement: un rail sans menu
 * cache l'import et les reglages, un menu sans rail coute deux gestes a chaque
 * changement d'outil.
 *
 * Feuille laterale et non feuille du bas: les panneaux d'outils occupent deja
 * le bas de l'ecran, et deux feuilles qui montent du meme bord seraient
 * indistinguables l'une de l'autre a l'ouverture.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { IconButton } from '../../components/ui/IconButton';
import {
  BeatIcon,
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  InfoIcon,
  LinkIcon,
  MagnetIcon,
  MusicIcon,
  PhotoIcon,
  PlusIcon,
  RedoIcon,
  SettingsIcon,
  ShareIcon,
  SparkIcon,
  SwapIcon,
  TextIcon,
  UndoIcon,
  VideoIcon,
} from '../../components/ui/icons';
import { SUPPORTED_LANGUAGES, setLanguage, type Language } from '../../i18n';
import { videoDuration } from '../../domain/timeline';
import { isProjectEmpty } from '../onboarding/onboardingState';
import { useNewProject } from './useNewProject';
import { formatRate } from '../../lib/format';
import type { ToolTab } from '../../store/useUiStore';

/** Version injectee par Vite depuis package.json a la compilation. */
const APP_VERSION = __APP_VERSION__;

/** Vitesses proposees, identiques a celles de l'ancien bouton de transport. */
const RATE_STEPS = [1, 0.5, 0.25, 2] as const;

export function MainMenu({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation(['menu', 'common', 'editor', 'export', 'about']);

  const project = useProjectStore((state) => state.project);
  const setSnapping = useProjectStore((state) => state.setSnapping);
  const distributeOnBeats = useProjectStore((state) => state.distributeOnBeats);

  const openTab = useUiStore((state) => state.openTab);
  const setExportOpen = useUiStore((state) => state.setExportOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const setAboutOpen = useUiStore((state) => state.setAboutOpen);
  const setInstallOpen = useUiStore((state) => state.setInstallOpen);
  const setTemplatesOpen = useUiStore((state) => state.setTemplatesOpen);

  const rate = usePlaybackStore((state) => state.rate);
  const setRate = usePlaybackStore((state) => state.setRate);

  const [confirmingNew, setConfirmingNew] = useState(false);
  const { startNewProject } = useNewProject();

  const history = useProjectStore.temporal;

  const canExport = videoDuration(project.videoTrack) > 0;
  const hasContent = !isProjectEmpty(project);
  const hasBeat = project.beatMap !== undefined;

  const currentLanguage = (i18n.resolvedLanguage ?? 'fr') as Language;
  const nextLanguage =
    SUPPORTED_LANGUAGES[
      (SUPPORTED_LANGUAGES.indexOf(currentLanguage) + 1) % SUPPORTED_LANGUAGES.length
    ]!;

  /* Fermeture au clavier: un panneau modal doit repondre a Echap. */
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Ouvre un panneau d'outil et referme le menu: sinon il resterait par-dessus. */
  const goToTab = (tab: ToolTab) => {
    onClose();
    openTab(tab);
  };

  /** Ouvre un ecran plein et referme le menu, pour la meme raison. */
  const goToScreen = (open: (value: boolean) => void) => {
    onClose();
    open(true);
  };

  return (
    <div className="absolute inset-0 z-40 flex">
      {/* Voile: fermer en touchant a cote est le geste attendu d'une feuille. */}
      <button
        type="button"
        aria-label={t('common:action.close')}
        onClick={onClose}
        className="flex-1 bg-ink-950/70 backdrop-blur-[2px]"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('menu:title')}
        className="surface flex w-[86%] max-w-sm flex-col border-l border-ink-700 bg-ink-900"
      >
        <header className="safe-pt flex h-appbar shrink-0 items-center justify-between border-b border-ink-700 pl-4 pr-1">
          <h2 className="text-sm font-semibold text-ink-50">{t('menu:title')}</h2>
          <IconButton label={t('common:action.close')} onClick={onClose} size="sm">
            <CloseIcon />
          </IconButton>
        </header>

        <div className="scrollbar-none safe-pb min-h-0 flex-1 overflow-y-auto p-3">
          {/* --- Projet --- */}
          <Section title={t('menu:sections.project')}>
            <Entry
              icon={<PlusIcon />}
              label={t('menu:project.new')}
              hint={t('menu:project.newHint')}
              onClick={() => {
                if (hasContent) {
                  setConfirmingNew(true);
                } else {
                  onClose();
                  void startNewProject();
                }
              }}
            />
            <Entry
              icon={<SparkIcon />}
              label={t('menu:project.templates')}
              hint={t('menu:project.templatesHint')}
              onClick={() => goToScreen(setTemplatesOpen)}
            />
          </Section>

          {/* --- Importer --- */}
          <Section title={t('menu:sections.import')}>
            <Entry
              icon={<PhotoIcon />}
              label={t('menu:import.media')}
              hint={t('menu:import.mediaHint')}
              onClick={() => goToTab('media')}
            />
            <Entry
              icon={<MusicIcon />}
              label={t('menu:import.audio')}
              hint={t('menu:import.audioHint')}
              onClick={() => goToTab('audio')}
            />
            <Entry
              icon={<VideoIcon />}
              label={t('menu:import.reel')}
              hint={t('menu:import.reelHint')}
              onClick={() => goToTab('media')}
            />
            <Entry
              icon={<LinkIcon />}
              label={t('menu:import.link')}
              hint={t('menu:import.linkHint')}
              onClick={() => goToTab('media')}
            />
          </Section>

          {/* --- Synchroniser --- */}
          <Section title={t('menu:sections.sync')}>
            <Entry
              icon={<BeatIcon />}
              label={t('menu:sync.beat')}
              hint={t('menu:sync.beatHint')}
              onClick={() => goToTab('beat')}
            />
            <Entry
              icon={<SwapIcon />}
              label={t('menu:sync.distribute')}
              hint={t('menu:sync.distributeHint')}
              // Sans analyse, la repartition n'a pas de grille sur quoi tomber.
              disabled={!hasBeat}
              onClick={() => {
                onClose();
                distributeOnBeats();
              }}
            />
            <Entry
              icon={<MagnetIcon />}
              label={t('menu:sync.snapping')}
              hint={t('menu:sync.snappingHint')}
              checked={project.snapping.enabled}
              onClick={() => setSnapping({ enabled: !project.snapping.enabled })}
            />
          </Section>

          {/* --- Editer --- */}
          <Section title={t('menu:sections.edit')}>
            <Entry
              icon={<SwapIcon />}
              label={t('menu:edit.clip')}
              hint={t('menu:edit.clipHint')}
              onClick={() => goToTab('edit')}
            />
            <Entry
              icon={<TextIcon />}
              label={t('menu:edit.text')}
              hint={t('menu:edit.textHint')}
              onClick={() => goToTab('text')}
            />
            <Entry
              icon={<SparkIcon />}
              label={t('menu:edit.effects')}
              hint={t('menu:edit.effectsHint')}
              onClick={() => goToTab('effects')}
            />
            <Entry
              icon={<MusicIcon />}
              label={t('menu:edit.audio')}
              hint={t('menu:edit.audioHint')}
              onClick={() => goToTab('audio')}
            />

            {/*
              Annuler / retablir aussi ICI, en plus des boutons flottants sur
              l'apercu: le menu doit contenir tout, sans quoi « je ne trouve
              pas » redevient possible.
            */}
            <Entry
              icon={<UndoIcon />}
              label={t('menu:edit.undo')}
              disabled={history.getState().pastStates.length === 0}
              onClick={() => history.getState().undo()}
            />
            <Entry
              icon={<RedoIcon />}
              label={t('menu:edit.redo')}
              disabled={history.getState().futureStates.length === 0}
              onClick={() => history.getState().redo()}
            />

            {/* Vitesse d'apercu: descendue ici depuis la barre de lecture, ou
                elle prenait une place permanente pour un reglage rare. */}
            <Entry
              icon={<span className="tnum text-[11px] font-bold">{formatRate(rate, i18n.language)}</span>}
              label={t('menu:edit.speed')}
              onClick={() => {
                const index = RATE_STEPS.indexOf(rate as (typeof RATE_STEPS)[number]);
                setRate(RATE_STEPS[(index + 1) % RATE_STEPS.length] ?? 1);
              }}
            />
          </Section>

          {/* --- Exporter --- */}
          <Section title={t('menu:sections.export')}>
            <Entry
              icon={<DownloadIcon />}
              label={t('menu:export.reel')}
              hint={canExport ? t('menu:export.reelHint') : t('menu:export.needClips')}
              disabled={!canExport}
              onClick={() => goToScreen(setExportOpen)}
            />
          </Section>

          {/* --- Configuration --- */}
          <Section title={t('menu:sections.config')}>
            <Entry
              icon={<SettingsIcon />}
              label={t('menu:config.settings')}
              hint={t('menu:config.settingsHint')}
              onClick={() => goToScreen(setSettingsOpen)}
            />
            <Entry
              icon={<span className="text-[11px] font-bold uppercase">{currentLanguage}</span>}
              label={t('menu:config.language')}
              onClick={() => void setLanguage(nextLanguage)}
            />
            <Entry
              icon={<ShareIcon />}
              label={t('menu:config.install')}
              hint={t('menu:config.installHint')}
              onClick={() => goToScreen(setInstallOpen)}
            />
          </Section>

          {/* --- A propos --- */}
          <Section title={t('menu:sections.about')}>
            <Entry
              icon={<InfoIcon />}
              label={t('menu:about.open')}
              hint={t('menu:about.version', { version: APP_VERSION })}
              onClick={() => goToScreen(setAboutOpen)}
            />
            <UpdateEntry />
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingNew}
        title={t('editor:project.newConfirmTitle')}
        description={t('editor:project.newConfirmBody')}
        confirmLabel={t('editor:project.newConfirm')}
        cancelLabel={t('common:action.cancel')}
        onCancel={() => setConfirmingNew(false)}
        onConfirm={() => {
          setConfirmingNew(false);
          onClose();
          void startNewProject();
        }}
      />
    </div>
  );
}

/**
 * Recherche de mise a jour.
 *
 * La PWA est en `autoUpdate`: le service worker installe la nouvelle version au
 * chargement suivant, sans rien demander. Cette entree ne fait que FORCER la
 * verification tout de suite, pour qui ne veut pas attendre un rechargement.
 */
function UpdateEntry() {
  const { t } = useTranslation(['menu']);
  const pushToast = useUiStore((state) => state.pushToast);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (!registration) {
        // Pas de service worker: onglet non installe, ou navigation privee.
        pushToast({ i18nKey: 'menu:about.upToDate', tone: 'info' });
        return;
      }

      await registration.update();

      // `installing` ou `waiting` non nuls = une version differente a ete
      // trouvee. Sinon le fichier servi est identique a celui deja actif.
      if (registration.installing || registration.waiting) {
        pushToast({ i18nKey: 'menu:about.updateFound', tone: 'info' });
        // Laisse le toast s'afficher avant de recharger.
        window.setTimeout(() => window.location.reload(), 1200);
      } else {
        pushToast({ i18nKey: 'menu:about.upToDate', tone: 'info' });
      }
    } catch {
      pushToast({ i18nKey: 'menu:about.updateFailed', tone: 'error' });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Entry
      icon={<DownloadIcon />}
      label={t('menu:about.checkUpdate')}
      hint={checking ? t('menu:about.updating') : undefined}
      disabled={checking}
      onClick={() => void check()}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-1 pt-2">
      <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-400">
        {title}
      </h3>
      <ul>{children}</ul>
    </section>
  );
}

interface EntryProps {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Etat coche, pour les entrees qui basculent un reglage. */
  checked?: boolean;
}

function Entry({ icon, label, hint, onClick, disabled, checked }: EntryProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={checked}
        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left active:bg-ink-800 disabled:opacity-60 [&>span>svg]:size-4"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink-850 text-ink-200">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink-100">{label}</span>
          {hint && <span className="block truncate text-xs text-ink-400">{hint}</span>}
        </span>
        {checked !== undefined && (
          <span
            aria-hidden="true"
            className={['shrink-0 [&>svg]:size-4', checked ? 'text-ok-400' : 'text-ink-700'].join(' ')}
          >
            <CheckIcon />
          </span>
        )}
      </button>
    </li>
  );
}
