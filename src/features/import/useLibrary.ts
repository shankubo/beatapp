/**
 * Acces a la bibliotheque personnelle.
 *
 * La liste vit dans un store Zustand plutot que dans un etat local: plusieurs
 * panneaux l'affichent (Media, et l'ecran de remplacement d'un plan), et ils
 * doivent voir le meme contenu apres un import ou une suppression.
 *
 * Le chargement depuis IndexedDB n'a lieu qu'une fois par session. Les
 * mutations mettent a jour la liste en memoire ET le stockage, sans relire:
 * relire apres chaque ajout ferait clignoter la grille.
 */

import { useEffect } from 'react';
import { create } from 'zustand';

import {
  addToLibrary,
  listLibrary,
  removeFromLibrary,
} from '../../storage/libraryStore';
import type { Id, MediaAsset } from '../../domain/types';

interface LibraryState {
  assets: MediaAsset[];
  loaded: boolean;
  /** Vrai pendant le chargement initial. */
  loading: boolean;

  load: () => Promise<void>;
  add: (asset: MediaAsset) => Promise<void>;
  remove: (assetId: Id) => Promise<void>;
  /**
   * Vide la bibliotheque.
   *
   * Ne supprime que des METADONNEES: les blobs restent partages dans
   * `mediaStore`, et le ramasse-miettes ne recupere que ceux qu'aucun projet ne
   * reference plus. Un media deja pose dans un montage y survit donc intact —
   * c'est la propriete qui rend ce bouton sur, et elle vient de la separation
   * « bibliotheque = metadonnees, mediaStore = blobs ».
   */
  clear: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>()((set, get) => ({
  assets: [],
  loaded: false,
  loading: false,

  load: async () => {
    // Deja charge ou chargement en cours: on ne relance rien.
    if (get().loaded || get().loading) return;
    set({ loading: true });
    const assets = await listLibrary();
    set({ assets, loaded: true, loading: false });
  },

  add: async (asset) => {
    // Mise a jour optimiste: la vignette apparait immediatement.
    set((state) => ({
      assets: [asset, ...state.assets.filter((a) => a.id !== asset.id)],
    }));
    await addToLibrary(asset);
  },

  remove: async (assetId) => {
    set((state) => ({ assets: state.assets.filter((a) => a.id !== assetId) }));
    await removeFromLibrary(assetId);
  },

  clear: async () => {
    /*
      La liste est capturee AVANT de vider l'etat.

      Les suppressions sont asynchrones: lire `get().assets` apres le `set`
      renverrait un tableau deja vide et rien ne serait efface du stockage. La
      grille se viderait a l'ecran, puis la bibliotheque reapparaitrait entiere
      au prochain chargement.
    */
    const { assets } = get();
    set({ assets: [] });
    await Promise.all(assets.map((asset) => removeFromLibrary(asset.id)));
  },
}));

/** Charge la bibliotheque au premier rendu qui en a besoin. */
export function useLibrary(): LibraryState {
  const state = useLibraryStore();

  useEffect(() => {
    void state.load();
    // `load` se garde lui-meme contre les appels multiples: la dependance sur
    // l'objet entier serait bruyante pour rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
