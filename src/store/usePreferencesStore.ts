/**
 * Preferences de TRAVAIL, persistees et hors historique.
 *
 * Separees des trois autres couches a dessein:
 * - `useProjectStore` est annulable et enregistre par projet — un reglage
 *   d'import ne doit ni s'annuler avec une coupe, ni disparaitre avec
 *   « Nouveau reel »;
 * - `useUiStore` est explicitement ni persiste ni annulable;
 * - `MediaProvider` ne detient que des objets non serialisables.
 *
 * Ces preferences survivent donc au rechargement et aux changements de projet,
 * ce qui est exactement le comportement attendu d'un reglage qu'on pose une fois
 * pour un lot de photos.
 */

import { create } from 'zustand';

import {
  DEFAULT_IMPORT_PREFERENCES,
  clampFrameSide,
  type ImportPreferences,
} from '../domain/types';

const STORAGE_KEY = 'beatapp.preferences';

interface PreferencesState {
  importPreferences: ImportPreferences;
  setImportPreferences: (patch: Partial<ImportPreferences>) => void;
  resetImportPreferences: () => void;
}

/**
 * Relecture defensive.
 *
 * Un enregistrement ecrit par une version anterieure peut ne pas porter tous les
 * champs, et le contenu de `localStorage` est modifiable a la main. On repart
 * donc des valeurs par defaut et on ne retient que les champs valides, plutot
 * que de faire confiance a la forme lue.
 */
function loadImportPreferences(): ImportPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_IMPORT_PREFERENCES;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_IMPORT_PREFERENCES;

    const stored = (parsed as { importPreferences?: unknown }).importPreferences;
    if (typeof stored !== 'object' || stored === null) return DEFAULT_IMPORT_PREFERENCES;

    const source = stored as Partial<Record<keyof ImportPreferences, unknown>>;
    return {
      frame: readFrame(source.frame),
      background: readBackground(source.background),
      fit: source.fit === 'contain' ? 'contain' : 'cover',
      autoRotate: source.autoRotate === true,
      autoZoom: source.autoZoom === true,
      autoCenter: source.autoCenter === true,
      showFramingGuides: source.showFramingGuides === true,
    };
  } catch {
    // Navigation privee ou donnee illisible: les defauts font parfaitement
    // l'affaire, et faire echouer le demarrage pour un reglage serait absurde.
    return DEFAULT_IMPORT_PREFERENCES;
  }
}

/**
 * Dimensions relues, assainies par le domaine.
 *
 * `clampFrameSide` est reapplique a la LECTURE et pas seulement a l'ecriture:
 * le contenu de `localStorage` se modifie a la main, et une dimension nulle ou
 * `NaN` propagee jusqu'au canvas ferait disparaitre l'image.
 */
function readFrame(value: unknown): ImportPreferences['frame'] {
  if (typeof value !== 'object' || value === null) return null;
  const { width, height } = value as { width?: unknown; height?: unknown };
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  return { width: clampFrameSide(width), height: clampFrameSide(height) };
}

function readBackground(value: unknown): ImportPreferences['background'] {
  if (typeof value !== 'object' || value === null) return null;
  const background = value as { type?: unknown; color?: unknown; amount?: unknown };

  if (background.type === 'blur') {
    // Une valeur non finie ou negative rendrait `blur()` invalide et le
    // navigateur ignorerait tout le filtre en silence.
    const amount = typeof background.amount === 'number' ? background.amount : 0.04;
    return { type: 'blur', amount: Number.isFinite(amount) ? Math.max(0, amount) : 0.04 };
  }

  if (background.type === 'color') {
    // Couleur restreinte a une notation hexadecimale: elle finit dans
    // `ctx.fillStyle`, ou une chaine arbitraire serait au mieux ignoree.
    const color =
      typeof background.color === 'string' && /^#[0-9a-f]{6}$/i.test(background.color)
        ? background.color
        : '#000000';
    return { type: 'color', color };
  }

  return null;
}

function persist(importPreferences: ImportPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ importPreferences }));
  } catch {
    // Quota plein ou navigation privee: le reglage vaut pour la session.
  }
}

export const usePreferencesStore = create<PreferencesState>()((set) => ({
  importPreferences: loadImportPreferences(),

  setImportPreferences: (patch) =>
    set((state) => {
      const importPreferences = { ...state.importPreferences, ...patch };
      persist(importPreferences);
      return { importPreferences };
    }),

  resetImportPreferences: () => {
    persist(DEFAULT_IMPORT_PREFERENCES);
    return set({ importPreferences: DEFAULT_IMPORT_PREFERENCES });
  },
}));
