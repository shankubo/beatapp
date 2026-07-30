import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import frAbout from './locales/fr/about.json';
import frCommon from './locales/fr/common.json';
import frEditor from './locales/fr/editor.json';
import frExport from './locales/fr/export.json';
import frInstall from './locales/fr/install.json';
import frSamples from './locales/fr/samples.json';
import frSettings from './locales/fr/settings.json';
import frErrors from './locales/fr/errors.json';

import enAbout from './locales/en/about.json';
import enCommon from './locales/en/common.json';
import enEditor from './locales/en/editor.json';
import enExport from './locales/en/export.json';
import enInstall from './locales/en/install.json';
import enSamples from './locales/en/samples.json';
import enSettings from './locales/en/settings.json';
import enErrors from './locales/en/errors.json';

import taAbout from './locales/ta/about.json';
import taCommon from './locales/ta/common.json';
import taEditor from './locales/ta/editor.json';
import taExport from './locales/ta/export.json';
import taInstall from './locales/ta/install.json';
import taSamples from './locales/ta/samples.json';
import taSettings from './locales/ta/settings.json';
import taErrors from './locales/ta/errors.json';

export const SUPPORTED_LANGUAGES = ['fr', 'en', 'ta'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const NAMESPACES = [
  'about',
  'common',
  'editor',
  'export',
  'install',
  'samples',
  'settings',
  'errors',
] as const;
export const DEFAULT_NS = 'common';

const STORAGE_KEY = 'beatapp.lang';

/** Le francais est la langue de reference: c'est elle qui definit les cles typees. */
export const frResources = {
  about: frAbout,
  common: frCommon,
  editor: frEditor,
  export: frExport,
  install: frInstall,
  samples: frSamples,
  settings: frSettings,
  errors: frErrors,
} as const;

const resources = {
  fr: frResources,
  en: {
    about: enAbout,
    common: enCommon,
    editor: enEditor,
    export: enExport,
    install: enInstall,
    samples: enSamples,
    settings: enSettings,
    errors: enErrors,
  },
  ta: {
    about: taAbout,
    common: taCommon,
    editor: taEditor,
    export: taExport,
    install: taInstall,
    samples: taSamples,
    settings: taSettings,
    errors: taErrors,
  },
} as const;

await i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'fr',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NS,
    // React echappe deja tout ce qu'il rend.
    interpolation: { escapeValue: false },
    returnNull: false,
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
  });

function syncDocumentLanguage(lng: string): void {
  document.documentElement.lang = lng;
}

syncDocumentLanguage(i18next.resolvedLanguage ?? 'fr');
i18next.on('languageChanged', syncDocumentLanguage);

export async function setLanguage(lng: Language): Promise<void> {
  await i18next.changeLanguage(lng);
}

export function currentLanguage(): Language {
  const resolved = i18next.resolvedLanguage;
  return SUPPORTED_LANGUAGES.includes(resolved as Language) ? (resolved as Language) : 'fr';
}

export default i18next;
