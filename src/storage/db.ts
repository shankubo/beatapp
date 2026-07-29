/**
 * Persistance locale. Aucun serveur n'est implique: les projets et les medias
 * vivent uniquement dans le navigateur de l'utilisateur.
 *
 * Repartition:
 * - IndexedDB pour les projets (petits, structures) et les petits blobs;
 * - OPFS pour les gros medias (video), ou IndexedDB devient lent et sujet aux
 *   pics memoire lors de la lecture.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BeatMap, Id, MediaAsset, Project } from '../domain/types';

const DB_NAME = 'beatapp';
/** v2: magasin `library`, la bibliotheque personnelle qui survit aux projets. */
const DB_VERSION = 2;

/** Au-dela de cette taille, le blob part dans OPFS plutot qu'IndexedDB. */
export const OPFS_THRESHOLD_BYTES = 20 * 1024 * 1024;

interface BeatappSchema extends DBSchema {
  projects: {
    key: Id;
    value: Project;
    indexes: { 'by-updatedAt': number };
  };
  /** Blobs de taille modeste (images, audio court). */
  media: {
    key: string;
    value: { key: string; blob: Blob; createdAt: number };
  };
  /** Analyses rythmiques mises en cache: l'analyse coute cher, le resultat non. */
  beatmaps: {
    key: Id;
    value: BeatMap;
  };
  /**
   * Bibliotheque personnelle: les medias que l'utilisateur conserve d'un reel a
   * l'autre.
   *
   * Volontairement SEPAREE des projets. Un media de la bibliotheque survit a
   * « Nouveau reel », alors que les medias d'un projet sont supprimes avec lui.
   * Sans cette distinction, refaire un reel avec les memes photos obligerait a
   * les reimporter a chaque fois.
   */
  library: {
    key: Id;
    value: MediaAsset;
    indexes: { 'by-createdAt': number };
  };
}

let dbPromise: Promise<IDBPDatabase<BeatappSchema>> | null = null;

export function getDb(): Promise<IDBPDatabase<BeatappSchema>> {
  dbPromise ??= openDB<BeatappSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Les migrations sont en cascade: chaque bloc fait avancer d'une version.
      if (oldVersion < 1) {
        const projects = db.createObjectStore('projects', { keyPath: 'id' });
        projects.createIndex('by-updatedAt', 'updatedAt');
        db.createObjectStore('media', { keyPath: 'key' });
        db.createObjectStore('beatmaps', { keyPath: 'assetId' });
      }

      if (oldVersion < 2) {
        const library = db.createObjectStore('library', { keyPath: 'id' });
        // Les medias les plus recents en premier: c'est l'ordre attendu d'une
        // pellicule.
        library.createIndex('by-createdAt', 'createdAt');
      }
    },
    blocked() {
      // Un autre onglet empeche la mise a niveau du schema.
      console.warn('[beatapp] mise a niveau de la base bloquee par un autre onglet');
    },
    blocking() {
      // Cet onglet bloque un autre: on ferme pour le laisser passer.
      void dbPromise?.then((db) => db.close());
      dbPromise = null;
    },
  });
  return dbPromise;
}

/** Erreur de stockage destinee a l'utilisateur (cle du namespace `errors`). */
export class StorageError extends Error {
  constructor(
    readonly i18nKey: string,
    options?: { cause?: unknown },
  ) {
    super(i18nKey, options);
    this.name = 'StorageError';
  }
}

/** Traduit une erreur IndexedDB / OPFS en erreur utilisateur. */
export function wrapStorageError(error: unknown, fallbackKey: string): StorageError {
  if (error instanceof Error && error.name === 'QuotaExceededError') {
    return new StorageError('storage.quotaExceeded', { cause: error });
  }
  return new StorageError(fallbackKey, { cause: error });
}

/** Espace disponible estime, pour prevenir avant saturation. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

/**
 * Demande la persistance du stockage.
 *
 * Sans cela, le navigateur peut evincer les donnees sous pression disque — et
 * l'utilisateur perdrait ses projets. On le demande une fois, sans bloquer.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
