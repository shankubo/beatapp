/**
 * Etat de lecture. Volontairement SEPARE du projet:
 * - il ne doit pas entrer dans l'historique d'annulation (annuler ne doit pas
 *   faire reculer la tete de lecture);
 * - il change a chaque frame pendant la lecture, donc il ne doit jamais etre
 *   persiste.
 */

import { create } from 'zustand';

import { clamp } from '../lib/math';
import { MAX_PREVIEW_RATE, MIN_PREVIEW_RATE, type Id, type Seconds } from '../domain/types';

interface PlaybackState {
  /** Position de lecture, en secondes. */
  time: Seconds;
  isPlaying: boolean;
  /** Clip selectionne, ou `null`. */
  selectedClipId: Id | null;
  selectedOverlayId: Id | null;
  /** Vrai pendant un geste de scrub: la lecture est suspendue. */
  isScrubbing: boolean;
  /**
   * Vitesse de l'APERCU, jamais celle du montage.
   *
   * Ici et non dans `useProjectStore`: c'est un outil de travail, pas une
   * propriete du reel. L'y mettre l'aurait fait entrer dans l'historique
   * d'annulation et, pire, l'aurait persiste — on rouvrirait son projet au
   * ralenti sans comprendre pourquoi. L'export ignore cette valeur.
   */
  rate: number;

  setTime: (time: Seconds) => void;
  setPlaying: (playing: boolean) => void;
  setRate: (rate: number) => void;
  selectClip: (clipId: Id | null) => void;
  selectOverlay: (overlayId: Id | null) => void;
  setScrubbing: (scrubbing: boolean) => void;
  /**
   * Remet la lecture a zero.
   *
   * Appele au changement de projet: les identifiants selectionnes designent des
   * clips qui n'existent plus, et les panneaux qui s'en servent afficheraient
   * des reglages fantomes.
   */
  reset: () => void;
}

export const usePlaybackStore = create<PlaybackState>()((set) => ({
  time: 0,
  isPlaying: false,
  selectedClipId: null,
  selectedOverlayId: null,
  isScrubbing: false,
  rate: 1,

  setTime: (time) => set({ time }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setRate: (rate) => set({ rate: clamp(rate, MIN_PREVIEW_RATE, MAX_PREVIEW_RATE) }),
  // Selectionner un clip deselectionne un texte, et inversement: un seul objet
  // est manipulable a la fois sur un ecran de telephone.
  selectClip: (selectedClipId) => set({ selectedClipId, selectedOverlayId: null }),
  selectOverlay: (selectedOverlayId) => set({ selectedOverlayId, selectedClipId: null }),
  setScrubbing: (isScrubbing) => set({ isScrubbing }),

  reset: () =>
    set({
      time: 0,
      isPlaying: false,
      selectedClipId: null,
      selectedOverlayId: null,
      isScrubbing: false,
      // La vitesse revient a la normale: retrouver un nouveau projet au ralenti
      // sans savoir pourquoi serait deroutant.
      rate: 1,
    }),
}));

/**
 * Lecture de la position hors de React.
 *
 * La boucle rAF met a jour le temps 60 fois par seconde. Passer par un
 * `useStore` ferait re-rendre l'arbre React a chaque frame; les composants qui
 * ont besoin du temps continu (playhead, timecode) s'abonnent directement.
 */
export function subscribeToTime(listener: (time: Seconds) => void): () => void {
  return usePlaybackStore.subscribe((state, previous) => {
    if (state.time !== previous.time) listener(state.time);
  });
}

export function currentTime(): Seconds {
  return usePlaybackStore.getState().time;
}
