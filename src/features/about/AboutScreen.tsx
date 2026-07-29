/**
 * Ecran « A propos »: ce que fait l'application, et ses mentions legales.
 *
 * Plein ecran comme les reglages et l'export. Tout le texte vit dans le
 * namespace `about`: une page legale doit pouvoir etre relue et amendee sans
 * toucher au code, et sa traduction est verifiee par `i18n:check` comme le
 * reste.
 */

import { useTranslation } from 'react-i18next';

import { IconButton } from '../../components/ui/IconButton';
import { CloseIcon } from '../../components/ui/icons';

/**
 * Version affichee.
 *
 * Injectee par Vite depuis `package.json` a la compilation: la recopier ici en
 * dur la laisserait derriver a la premiere publication.
 */
const APP_VERSION = __APP_VERSION__;

/** Fonctions listees, dans l'ordre d'affichage. */
const FEATURES = ['beat', 'import', 'edit', 'transitions', 'text', 'export'] as const;

/** Sections legales, dans l'ordre d'affichage. */
const LEGAL_SECTIONS = ['copyright', 'personal', 'liability', 'host', 'data'] as const;

export function AboutScreen({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['about', 'common']);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-ink-950">
      <header className="safe-pt flex h-appbar shrink-0 items-center justify-between border-b border-ink-700 pl-4 pr-1">
        <h2 className="text-sm font-semibold text-ink-50">{t('about:title')}</h2>
        <IconButton label={t('common:action.close')} onClick={onClose} size="sm">
          <CloseIcon />
        </IconButton>
      </header>

      <div className="scrollbar-none safe-pb min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {/* --- Identite --- */}
        <section className="space-y-1">
          <p className="text-sm leading-relaxed text-ink-200">{t('about:tagline')}</p>
          <p className="tnum text-xs text-ink-400">
            {t('about:version', { version: APP_VERSION })}
          </p>
          <p className="text-xs text-ink-400">
            {t('about:developer.label')} — {t('about:developer.name')}
          </p>
        </section>

        {/* --- Ce que fait l'application --- */}
        <Section title={t('about:what.title')}>
          <p className="text-sm leading-relaxed text-ink-300">{t('about:what.body')}</p>
        </Section>

        {/*
          Confidentialite mise en avant par un encadre.

          C'est la promesse structurante du projet — rien ne quitte l'appareil —
          et la noyer dans le corps du texte lui ferait perdre le poids qu'elle a.
        */}
        <section className="space-y-2 rounded-xl border border-ok-400/35 bg-ink-850 p-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ok-400">
            {t('about:privacy.title')}
          </h3>
          <p className="text-sm leading-relaxed text-ink-300">{t('about:privacy.body')}</p>
          <p className="text-xs leading-relaxed text-ink-400">{t('about:privacy.offline')}</p>
        </section>

        {/* --- Fonctions --- */}
        <Section title={t('about:features.title')}>
          <ul className="space-y-1.5">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex gap-2 text-sm leading-relaxed text-ink-300">
                {/* Puce decorative: le texte porte deja le sens. */}
                <span aria-hidden="true" className="text-beat-400">
                  ·
                </span>
                <span>{t(`about:features.${feature}`)}</span>
              </li>
            ))}
          </ul>
        </Section>

        {/*
          Limites annoncees franchement, et non passees sous silence.

          Les liens de reseaux sociaux et la transcription sont les deux attentes
          que l'application ne peut pas satisfaire. Les taire ferait passer une
          impossibilite technique pour une panne.
        */}
        <Section title={t('about:limits.title')}>
          <p className="text-sm leading-relaxed text-ink-300">{t('about:limits.social')}</p>
          <p className="text-sm leading-relaxed text-ink-300">
            {t('about:limits.transcription')}
          </p>
        </Section>

        {/* --- Mentions legales --- */}
        <section className="space-y-3 border-t border-ink-700 pt-5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-300">
            {t('about:legal.title')}
          </h3>
          <p className="text-sm leading-relaxed text-ink-300">{t('about:legal.intro')}</p>

          {LEGAL_SECTIONS.map((section) => (
            <div key={section} className="space-y-1 pt-1">
              <h4 className="text-sm font-medium text-ink-100">
                {t(`about:legal.${section}.title`)}
              </h4>
              <p className="text-sm leading-relaxed text-ink-400">
                {t(`about:legal.${section}.body`)}
              </p>
            </div>
          ))}
        </section>

        {/* --- Licences --- */}
        <Section title={t('about:licenses.title')}>
          <p className="text-sm leading-relaxed text-ink-400">{t('about:licenses.body')}</p>
        </Section>
      </div>
    </div>
  );
}

/** Section titree, pour ne pas repeter la meme structure six fois. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-300">{title}</h3>
      {children}
    </section>
  );
}
