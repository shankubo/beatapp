/**
 * Etat de l'interface: quel panneau est ouvert, zoom de la timeline, messages.
 * Ni persiste, ni annulable.
 */

import { create } from 'zustand';

import type { ImportErrorKey } from '../features/import/importMedia';
import type { UrlImportErrorKey } from '../features/import/importUrl';
import type { AiErrorKey } from '../features/text/aiLyrics';

export type ToolTab = 'media' | 'edit' | 'audio' | 'text' | 'effects' | 'beat';

export type SheetSnap = 'closed' | 'peek' | 'half' | 'full';

/**
 * Cles de toast, enumerees explicitement.
 *
 * Un toast porte une CLE et non un message: si l'utilisateur change de langue
 * pendant que le toast est affiche, il doit changer avec elle.
 *
 * L'enumeration est deliberee plutot que derivee de `TFunction`: la liste des
 * messages reellement utilisables comme toast est courte, et l'ecrire ici la
 * rend lisible tout en gardant la verification a la compilation.
 */
export type ToastKey =
  | 'editor:timeline.clipDeleted'
  | 'editor:timeline.snapEnabled'
  | 'editor:timeline.snapDisabled'
  | 'common:pwa.offlineReady'
  | 'common:pwa.updateAvailable'
  | 'samples:templates.applied'
  | ImportErrorKey
  | UrlImportErrorKey
  | 'editor:onboarding.needMedia'
  | 'install:share.copied'
  | 'install:share.copyFailed'
  | 'errors:audio.decodeFailed'
  | 'errors:audio.analysisFailed'
  | 'errors:audio.tooQuiet'
  | AiErrorKey
  | 'errors:speech.unsupported'
  | 'errors:speech.denied'
  | 'errors:speech.failed'
  | 'errors:lyricsFile.unreadable'
  | 'errors:lyricsFile.empty'
  | 'errors:storage.quotaExceeded'
  | 'errors:storage.saveFailed'
  | 'errors:storage.loadFailed';

export interface Toast {
  id: number;
  i18nKey: ToastKey;
  params?: Record<string, string | number>;
  tone: 'info' | 'error';
  /** Action d'annulation optionnelle (p. ex. apres suppression d'un clip). */
  undo?: () => void;
}

/** Bornes de zoom de la timeline, en pixels par seconde. */
export const MIN_PX_PER_SECOND = 8;
export const MAX_PX_PER_SECOND = 400;
export const DEFAULT_PX_PER_SECOND = 60;

interface UiState {
  activeTab: ToolTab | null;
  sheetSnap: SheetSnap;
  pxPerSecond: number;
  toasts: Toast[];
  /** Ecran d'export ouvert. */
  exportOpen: boolean;
  /** Ecran de reglages ouvert. */
  settingsOpen: boolean;
  /** Galerie de modeles ouverte. */
  templatesOpen: boolean;
  /** Ecran « A propos » ouvert. */
  aboutOpen: boolean;
  /** Ecran « Installer l'application » ouvert. */
  installOpen: boolean;
  /**
   * Mode compact: les barres se superposent a l'apercu au lieu de le rogner.
   *
   * Distinct du plein ecran, qui retire la timeline: ici on continue a monter,
   * on gagne seulement la hauteur que le decor prenait.
   */
  compactChrome: boolean;
  /**
   * Timeline repliee: seule une poignee reste visible.
   *
   * Mesure sur 390x844 — c'est de loin le plus gros gain disponible (+103 px de
   * largeur d'apercu, contre +50 pour les deux barres reunies), parce que la
   * regle et les trois bandes pesent a elles seules 182 px.
   */
  timelineCollapsed: boolean;
  /**
   * Barres repliees individuellement.
   *
   * Mesure sur 390x844, gain de LARGEUR d'apercu par pliage:
   *   AppBar     +15 px      Transport  +15 px
   *   Timeline   +69 px      ToolTabs    +0 px
   *
   * Le zero de `ToolTabs` n'est pas une erreur: des que le chrome descend sous
   * 151 px, l'apercu 9:16 devient limite par la LARGEUR de l'ecran (390 px) et
   * cesse de grandir. Replier les onglets reste utile pour degager la vue, pas
   * pour agrandir l'image — et l'interface ne doit pas laisser croire l'inverse.
   */
  appBarCollapsed: boolean;
  transportCollapsed: boolean;
  tabsCollapsed: boolean;
  /**
   * Ecran de demarrage en 3 etapes.
   *
   * Par defaut ferme: il n'est ouvert qu'explicitement, une fois le projet
   * restaure. L'evaluer pendant le chargement ferait clignoter les 3 etapes
   * avant de reveler un montage en cours.
   */
  onboardingOpen: boolean;
  /**
   * Apercu en plein ecran.
   *
   * Etat d'interface et non `requestFullscreen`: l'API native n'existe pas sur
   * iOS Safari pour un element quelconque, et le comportement doit etre le meme
   * partout. On masque simplement le reste de l'editeur.
   */
  fullscreen: boolean;

  openTab: (tab: ToolTab) => void;
  closeSheet: () => void;
  setSheetSnap: (snap: SheetSnap) => void;
  setPxPerSecond: (value: number) => void;
  pushToast: (toast: Omit<Toast, 'id'>) => number;
  dismissToast: (id: number) => void;
  setExportOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
  setInstallOpen: (open: boolean) => void;
  setTemplatesOpen: (open: boolean) => void;
  setCompactChrome: (compact: boolean) => void;
  setTimelineCollapsed: (collapsed: boolean) => void;
  setAppBarCollapsed: (collapsed: boolean) => void;
  setTransportCollapsed: (collapsed: boolean) => void;
  setTabsCollapsed: (collapsed: boolean) => void;
  setOnboardingOpen: (open: boolean) => void;
  setFullscreen: (open: boolean) => void;
}

let nextToastId = 1;

export const useUiStore = create<UiState>()((set) => ({
  activeTab: null,
  sheetSnap: 'closed',
  pxPerSecond: DEFAULT_PX_PER_SECOND,
  toasts: [],
  exportOpen: false,
  settingsOpen: false,
  templatesOpen: false,
  aboutOpen: false,
  installOpen: false,
  compactChrome: false,
  timelineCollapsed: false,
  appBarCollapsed: false,
  transportCollapsed: false,
  tabsCollapsed: false,
  onboardingOpen: false,
  fullscreen: false,

  openTab: (tab) =>
    set((state) =>
      // Retaper l'onglet actif referme le panneau: comportement attendu d'une
      // barre d'onglets sur mobile.
      state.activeTab === tab && state.sheetSnap !== 'closed'
        ? { activeTab: null, sheetSnap: 'closed' }
        : { activeTab: tab, sheetSnap: 'half' },
    ),

  closeSheet: () => set({ activeTab: null, sheetSnap: 'closed' }),

  setSheetSnap: (sheetSnap) =>
    set(sheetSnap === 'closed' ? { sheetSnap, activeTab: null } : { sheetSnap }),

  setPxPerSecond: (value) =>
    set({
      pxPerSecond: Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, value)),
    }),

  pushToast: (toast) => {
    const id = nextToastId++;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    return id;
  },

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  setExportOpen: (exportOpen) => set({ exportOpen }),

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  setAboutOpen: (aboutOpen) => set({ aboutOpen }),

  setInstallOpen: (installOpen) => set({ installOpen }),

  // Ouvrir la galerie referme la feuille: une feuille active derriere un ecran
  // plein est un etat invisible mais vivant. Meme regle que le plein ecran.
  setTemplatesOpen: (templatesOpen) =>
    set(templatesOpen ? { templatesOpen, activeTab: null, sheetSnap: 'closed' } : { templatesOpen }),

  setCompactChrome: (compactChrome) => set({ compactChrome }),

  setTimelineCollapsed: (timelineCollapsed) => set({ timelineCollapsed }),

  setAppBarCollapsed: (appBarCollapsed) => set({ appBarCollapsed }),

  setTransportCollapsed: (transportCollapsed) => set({ transportCollapsed }),

  // Replier les onglets ferme le panneau: le garder ouvert sans sa barre
  // laisserait une feuille sans moyen d'en changer ni de la refermer.
  setTabsCollapsed: (tabsCollapsed) =>
    set(tabsCollapsed ? { tabsCollapsed, activeTab: null, sheetSnap: 'closed' } : { tabsCollapsed }),

  setOnboardingOpen: (onboardingOpen) => set({ onboardingOpen }),

  // Passer en plein ecran referme le panneau: le garder ouvert derriere un
  // apercu qui couvre l'ecran laisserait un etat invisible mais actif.
  setFullscreen: (fullscreen) =>
    set(fullscreen ? { fullscreen, activeTab: null, sheetSnap: 'closed' } : { fullscreen }),
}));
