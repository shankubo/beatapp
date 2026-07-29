/**
 * Stockage des blobs medias.
 *
 * Deux backends derriere une seule API:
 * - `idb` pour les petits fichiers (images, audio courts);
 * - `opfs` pour les gros (video), ou IndexedDB devient lent et provoque des
 *   pics memoire a la lecture. OPFS lit par flux, sans tout charger.
 *
 * L'appelant ne choisit pas: `putMedia` decide selon la taille et renvoie la
 * reference a stocker dans le `MediaAsset`.
 */

import { getDb, OPFS_THRESHOLD_BYTES, wrapStorageError } from './db';
import type { MediaAsset } from '../domain/types';

export type StorageRef = MediaAsset['storage'];

const OPFS_DIR = 'media';

async function opfsDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

function opfsAvailable(): boolean {
  return typeof navigator.storage?.getDirectory === 'function';
}

/** Enregistre un blob et renvoie sa reference de stockage. */
export async function putMedia(key: string, blob: Blob): Promise<StorageRef> {
  const useOpfs = blob.size >= OPFS_THRESHOLD_BYTES && opfsAvailable();

  try {
    if (useOpfs) {
      const dir = await opfsDirectory();
      const handle = await dir.getFileHandle(key, { create: true });
      const writable = await handle.createWritable();
      // `blob.stream()` evite de materialiser le fichier entier en memoire.
      await blob.stream().pipeTo(writable);
      return { backend: 'opfs', key };
    }

    const db = await getDb();
    await db.put('media', { key, blob, createdAt: Date.now() });
    return { backend: 'idb', key };
  } catch (error) {
    throw wrapStorageError(error, 'storage.saveFailed');
  }
}

/** Relit un blob. Renvoie `null` si la reference ne pointe plus sur rien. */
export async function getMedia(ref: StorageRef): Promise<Blob | null> {
  try {
    if (ref.backend === 'opfs') {
      if (!opfsAvailable()) return null;
      const dir = await opfsDirectory();
      const handle = await dir.getFileHandle(ref.key);
      return await handle.getFile();
    }

    const db = await getDb();
    const record = await db.get('media', ref.key);
    return record?.blob ?? null;
  } catch (error) {
    // Un fichier absent n'est pas une erreur exploitable par l'utilisateur:
    // l'appelant nettoiera le projet via `pruneDanglingClips`.
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw wrapStorageError(error, 'storage.loadFailed');
  }
}

export async function deleteMedia(ref: StorageRef): Promise<void> {
  try {
    if (ref.backend === 'opfs') {
      if (!opfsAvailable()) return;
      const dir = await opfsDirectory();
      await dir.removeEntry(ref.key).catch(() => undefined);
      return;
    }
    const db = await getDb();
    await db.delete('media', ref.key);
  } catch {
    // La suppression est un nettoyage: un echec ne doit pas casser l'edition.
  }
}

/**
 * Charge en parallele tous les blobs necessaires a un ensemble de medias.
 * Les medias introuvables sont simplement absents de la Map renvoyee.
 */
export async function loadMediaBlobs(
  assets: readonly MediaAsset[],
): Promise<Map<string, Blob>> {
  const entries = await Promise.all(
    assets.map(async (asset) => {
      const blob = await getMedia(asset.storage);
      return [asset.id, blob] as const;
    }),
  );

  const result = new Map<string, Blob>();
  for (const [id, blob] of entries) {
    if (blob) result.set(id, blob);
  }
  return result;
}

/**
 * Supprime les blobs qui ne sont plus references par aucun projet.
 * Appele au demarrage: sans cela, les medias d'un projet supprime resteraient
 * indefiniment sur l'appareil.
 *
 * `referencedKeys` a `null` signifie "liste inconnue": on ne supprime alors
 * rien, plutot que de risquer d'effacer les medias de l'utilisateur.
 */
export async function collectGarbage(
  referencedKeys: ReadonlySet<string> | null,
): Promise<number> {
  if (referencedKeys === null) return 0;

  let removed = 0;

  try {
    const db = await getDb();
    const keys = await db.getAllKeys('media');
    for (const key of keys) {
      if (!referencedKeys.has(key)) {
        await db.delete('media', key);
        removed += 1;
      }
    }
  } catch {
    // Sans consequence: on retentera au prochain demarrage.
  }

  if (opfsAvailable()) {
    try {
      const dir = await opfsDirectory();
      // `keys()` n'est pas encore typee partout: on itere prudemment.
      for await (const name of (dir as unknown as AsyncIterable<string> & {
        keys(): AsyncIterableIterator<string>;
      }).keys()) {
        if (!referencedKeys.has(name)) {
          await dir.removeEntry(name).catch(() => undefined);
          removed += 1;
        }
      }
    } catch {
      // Idem.
    }
  }

  return removed;
}
