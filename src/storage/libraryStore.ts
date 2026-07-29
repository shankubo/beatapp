/**
 * Bibliotheque personnelle: les medias conserves d'un reel a l'autre.
 *
 * C'est la difference essentielle avec les medias d'un projet: ceux-ci sont
 * supprimes avec lui quand on repart a neuf, alors que la bibliotheque persiste.
 * Sans cette separation, refaire un montage avec les memes photos obligerait a
 * les reimporter a chaque fois.
 *
 * Le magasin ne contient que des METADONNEES (`MediaAsset`). Les blobs restent
 * dans `mediaStore`, partages: un media present a la fois dans la bibliotheque
 * et dans le projet courant n'occupe l'espace qu'une seule fois.
 */

import { getDb, wrapStorageError } from './db';
import type { Id, MediaAsset } from '../domain/types';

/** Ajoute (ou met a jour) un media dans la bibliotheque. */
export async function addToLibrary(asset: MediaAsset): Promise<void> {
  try {
    const db = await getDb();
    await db.put('library', asset);
  } catch (error) {
    throw wrapStorageError(error, 'storage.saveFailed');
  }
}

/** Tous les medias conserves, du plus recent au plus ancien. */
export async function listLibrary(): Promise<MediaAsset[]> {
  try {
    const db = await getDb();
    const assets = await db.getAllFromIndex('library', 'by-createdAt');
    return assets.reverse();
  } catch {
    // Une bibliotheque illisible ne doit pas empecher d'editer: on renvoie vide.
    return [];
  }
}

/** Retire un media de la bibliotheque. Le blob est nettoye par le ramasse-miettes. */
export async function removeFromLibrary(assetId: Id): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('library', assetId);
  } catch (error) {
    throw wrapStorageError(error, 'storage.saveFailed');
  }
}

/**
 * Cles de blobs referencees par la bibliotheque.
 *
 * `referencedMediaKeys` (cote projets) l'appelle et fusionne les deux ensembles:
 * sans cela, le ramasse-miettes lance par « Nouveau reel » supprimerait les
 * blobs de la bibliotheque, qu'aucun projet ne reference plus.
 *
 * Renvoie `null` si la liste n'a pas pu etre etablie — meme convention que pour
 * les projets: en cas de doute, on ne supprime rien.
 */
export async function libraryMediaKeys(): Promise<Set<string> | null> {
  try {
    const db = await getDb();
    const assets = await db.getAll('library');
    return new Set(assets.map((asset) => asset.storage.key));
  } catch {
    return null;
  }
}
