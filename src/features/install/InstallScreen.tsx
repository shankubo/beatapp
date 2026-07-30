/**
 * Ecran « Installer l'application »: le QR code, le partage, et la marche a
 * suivre sur iOS, Android et ordinateur.
 *
 * Plein ecran comme « A propos », dont il suit la structure. Tout le texte vit
 * dans le namespace `install`, verifie par `i18n:check`.
 *
 * L'onglet ouvert au chargement est DEDUIT de l'appareil (`detectPlatform`):
 * quelqu'un sur iPhone veut la procedure iPhone, pas un choix a faire. Les
 * trois restent accessibles — on partage souvent depuis un appareil pour un
 * autre, ce que fait justement le QR code.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { IconButton } from '../../components/ui/IconButton';
import { QrCode } from '../../components/ui/QrCode';
import { CloseIcon, CopyIcon, ShareIcon } from '../../components/ui/icons';
import { APP_URL } from '../../domain/appUrl';
import { detectPlatform, type Platform } from './platform';
import { useUiStore } from '../../store/useUiStore';

/** Plateformes documentees, dans l'ordre des onglets. */
const PLATFORMS: readonly Platform[] = ['ios', 'android', 'desktop'];

/**
 * Cles des etapes, ecrites en toutes lettres.
 *
 * Une cle construite (`steps.${platform}.step${i}`) compilerait, mais le typage
 * des cles du projet ne pourrait plus rien verifier: une etape supprimee d'un
 * seul fichier de langue ne se verrait qu'a l'execution. Enumerees, elles sont
 * controlees a la compilation comme le reste.
 */
const STEP_KEYS = {
  ios: [
    'install:steps.ios.step1',
    'install:steps.ios.step2',
    'install:steps.ios.step3',
    'install:steps.ios.step4',
  ],
  android: [
    'install:steps.android.step1',
    'install:steps.android.step2',
    'install:steps.android.step3',
    'install:steps.android.step4',
  ],
  desktop: [
    'install:steps.desktop.step1',
    'install:steps.desktop.step2',
    'install:steps.desktop.step3',
    'install:steps.desktop.step4',
  ],
} as const satisfies Record<Platform, readonly string[]>;

/** Titres et remarques, enumeres pour la meme raison. */
const PANEL_KEYS = {
  ios: { title: 'install:steps.ios.title', note: 'install:steps.ios.note' },
  android: { title: 'install:steps.android.title', note: 'install:steps.android.note' },
  desktop: { title: 'install:steps.desktop.title', note: 'install:steps.desktop.note' },
} as const satisfies Record<Platform, { title: string; note: string }>;

/** Libelles des onglets. */
const TAB_KEYS = {
  ios: 'install:platform.ios',
  android: 'install:platform.android',
  desktop: 'install:platform.desktop',
} as const satisfies Record<Platform, string>;

export function InstallScreen({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['install', 'common']);
  const pushToast = useUiStore((state) => state.pushToast);

  const [platform, setPlatform] = useState<Platform>(() => detectPlatform(navigator.userAgent));

  // --- Partage natif, avec repli sur le presse-papiers.
  const handleShare = async () => {
    const payload = { title: t('install:share.title'), text: t('install:share.text'), url: APP_URL };

    // `navigator.share` n'existe pas partout, et l'utilisateur peut annuler la
    // feuille de partage: une annulation n'est pas une erreur, on se tait.
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch {
        return;
      }
    }

    try {
      await navigator.clipboard.writeText(APP_URL);
      pushToast({ i18nKey: 'install:share.copied', tone: 'info' });
    } catch {
      pushToast({ i18nKey: 'install:share.copyFailed', tone: 'error' });
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(APP_URL);
      pushToast({ i18nKey: 'install:share.copied', tone: 'info' });
    } catch {
      pushToast({ i18nKey: 'install:share.copyFailed', tone: 'error' });
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-ink-950">
      <header className="appbar-top flex shrink-0 items-center justify-between border-b border-ink-700 pl-4 pr-1">
        <h2 className="text-sm font-semibold text-ink-50">{t('install:title')}</h2>
        <IconButton label={t('common:action.close')} onClick={onClose} size="sm">
          <CloseIcon />
        </IconButton>
      </header>

      <div className="scrollbar-none safe-pb min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        <p className="text-sm leading-relaxed text-ink-300">{t('install:intro')}</p>

        {/* --- QR code et partage --- */}
        <section className="space-y-3 rounded-2xl border border-ink-700 bg-ink-850 p-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-300">
            {t('install:scan.title')}
          </h3>

          <div className="flex justify-center">
            {/*
              Taille genereuse: sous ~160 px, un appareil photo de telephone
              peine a resoudre les modules d'un code version 3 a la distance ou
              on tient naturellement l'appareil.
            */}
            <QrCode
              value={APP_URL}
              label={t('install:scan.alt')}
              className="size-48 rounded-xl"
            />
          </div>

          <p className="text-center text-xs leading-relaxed text-ink-400">
            {t('install:scan.hint')}
          </p>

          {/* L'adresse en clair sous le code: tout le monde ne peut pas scanner,
              et une adresse courte se recopie a la main. */}
          <p className="break-all text-center text-xs text-ink-300">{APP_URL}</p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleShare()}
              className="surface flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-ink-600 bg-ink-900 text-sm font-medium text-ink-100 active:bg-ink-800 [&>svg]:size-4"
            >
              <ShareIcon />
              {t('install:share.action')}
            </button>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="surface flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-ink-600 bg-ink-900 text-sm font-medium text-ink-100 active:bg-ink-800 [&>svg]:size-4"
            >
              <CopyIcon />
              {t('install:share.copy')}
            </button>
          </div>
        </section>

        {/* --- Marche a suivre, par plateforme --- */}
        <section className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-300">
            {t('install:how.title')}
          </h3>

          {/*
            Onglets en `radiogroup` et non en boutons libres: ils sont
            mutuellement exclusifs, et c'est ce que doit entendre un lecteur
            d'ecran.
          */}
          <div role="radiogroup" aria-label={t('install:how.title')} className="flex gap-2">
            {PLATFORMS.map((key) => {
              const active = key === platform;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPlatform(key)}
                  className={[
                    'min-h-11 flex-1 rounded-xl border text-xs font-medium transition-colors',
                    active
                      ? 'border-media-400/60 bg-media-400/15 text-media-400'
                      : 'surface border-ink-600 bg-ink-850 text-ink-300 active:bg-ink-800',
                  ].join(' ')}
                >
                  {t(TAB_KEYS[key])}
                </button>
              );
            })}
          </div>

          <div className="space-y-3 rounded-2xl border border-ink-700 bg-ink-850 p-4">
            <p className="text-sm font-medium text-ink-100">{t(PANEL_KEYS[platform].title)}</p>

            {/* Liste ORDONNEE: ce sont des etapes a suivre dans l'ordre, et un
                lecteur d'ecran doit les annoncer numerotees. */}
            <ol className="space-y-2">
              {STEP_KEYS[platform].map((key, i) => (
                <li key={key} className="flex gap-3 text-sm leading-relaxed text-ink-300">
                  <span
                    aria-hidden="true"
                    className="tnum flex size-5 shrink-0 items-center justify-center rounded-full bg-ink-700 text-xs font-semibold text-ink-200"
                  >
                    {i + 1}
                  </span>
                  <span>{t(key)}</span>
                </li>
              ))}
            </ol>

            <p className="text-xs leading-relaxed text-ink-400">{t(PANEL_KEYS[platform].note)}</p>
          </div>
        </section>

        {/* --- Pourquoi installer --- */}
        <section className="space-y-2 rounded-xl border border-ok-400/35 bg-ink-850 p-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ok-400">
            {t('install:why.title')}
          </h3>
          <p className="text-sm leading-relaxed text-ink-300">{t('install:why.body')}</p>
        </section>
      </div>
    </div>
  );
}
