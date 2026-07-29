/**
 * Stockage des cles API, sur l'appareil uniquement.
 *
 * Une cle est un secret de l'utilisateur, pas une donnee de projet. Elle ne va
 * donc SURTOUT pas dans `useProjectStore`: cet etat est persiste avec le montage
 * et passe dans l'historique d'annulation, si bien qu'un « Annuler » pourrait
 * effacer la cle, et un futur export de projet l'emporterait avec lui.
 *
 * `localStorage` plutot qu'IndexedDB: une chaine courte, lue de facon synchrone
 * au premier rendu. Ni l'un ni l'autre n'est chiffre — aucun stockage navigateur
 * ne l'est — et c'est acceptable ici parce que la cle appartient a l'utilisateur
 * et ne quitte son appareil que vers le fournisseur qui l'a emise.
 */

import type { AiProvider } from '../features/text/aiLyrics';

const PREFIX = 'beatapp.ai.key.';

/** Lit la cle d'un fournisseur. Chaine vide si absente. */
export function readAiKey(provider: AiProvider): string {
  try {
    return localStorage.getItem(`${PREFIX}${provider}`) ?? '';
  } catch {
    // `localStorage` leve en navigation privee sur certains navigateurs: une
    // cle indisponible doit degrader la fonction, jamais casser l'application.
    return '';
  }
}

/** Enregistre une cle, ou l'efface si elle est vide. */
export function writeAiKey(provider: AiProvider, key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed.length === 0) localStorage.removeItem(`${PREFIX}${provider}`);
    else localStorage.setItem(`${PREFIX}${provider}`, trimmed);
  } catch {
    // Quota plein ou stockage refuse: sans effet, l'utilisateur ressaisira.
  }
}
