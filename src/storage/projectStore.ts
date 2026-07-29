/**
 * Persistance des projets et des analyses rythmiques.
 *
 * L'enregistrement est automatique et debounce: l'utilisateur ne doit jamais
 * penser a sauvegarder, et fermer l'onglet en pleine edition ne doit rien
 * perdre.
 */

import { getDb, wrapStorageError } from './db';
import { libraryMediaKeys } from './libraryStore';
import { migrateProject, pruneDanglingClips } from '../domain/project';
import { isStale } from '../domain/beatmap';
import { BEAT_ALGO_VERSION, type BeatMap, type Id, type Project } from '../domain/types';

export async function saveProject(project: Project): Promise<void> {
  try {
    const db = await getDb();
    await db.put('projects', project);
  } catch (error) {
    throw wrapStorageError(error, 'storage.saveFailed');
  }
}

export async function loadProject(id: Id): Promise<Project | null> {
  try {
    const db = await getDb();
    const raw = await db.get('projects', id);
    if (!raw) return null;
    // La migration puis le nettoyage: un media supprime hors de l'app laisserait
    // sinon des clips pointant dans le vide.
    return pruneDanglingClips(migrateProject(raw));
  } catch (error) {
    throw wrapStorageError(error, 'storage.loadFailed');
  }
}

/** Projets les plus recemment modifies d'abord. */
export async function listProjects(limit = 20): Promise<Project[]> {
  try {
    const db = await getDb();
    const all = await db.getAllFromIndex('projects', 'by-updatedAt');
    return all.reverse().slice(0, limit);
  } catch (error) {
    throw wrapStorageError(error, 'storage.loadFailed');
  }
}

export async function deleteProject(id: Id): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('projects', id);
  } catch (error) {
    throw wrapStorageError(error, 'storage.saveFailed');
  }
}

/** Le projet ouvert au dernier lancement, pour reprendre ou l'on s'est arrete. */
const LAST_PROJECT_KEY = 'beatapp.lastProjectId';

export function rememberLastProject(id: Id): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // Mode navigation privee: on repartira d'un projet neuf, sans plus.
  }
}

export function lastProjectId(): Id | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Enregistrement automatique
// ---------------------------------------------------------------------------

/**
 * Enregistreur automatique debounce.
 *
 * `flush()` force l'ecriture immediate: appele sur `visibilitychange`, car sur
 * mobile l'onglet peut etre tue sans preavis apres passage en arriere-plan.
 */
export class ProjectAutosaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Project | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly delayMs = 800,
    private readonly onError?: (error: unknown) => void,
  ) {}

  schedule(project: Project): void {
    this.pending = project;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const project = this.pending;
    if (!project) return;
    this.pending = null;

    // On serialise les ecritures: deux `put` concurrents sur le meme projet
    // pourraient s'ecrire l'un par-dessus l'autre dans un ordre imprevisible.
    this.inFlight = (this.inFlight ?? Promise.resolve())
      .then(() => saveProject(project))
      .catch((error: unknown) => {
        this.onError?.(error);
      });

    await this.inFlight;
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}

// ---------------------------------------------------------------------------
// Cache des analyses rythmiques
// ---------------------------------------------------------------------------

export async function saveBeatMap(beatMap: BeatMap): Promise<void> {
  try {
    const db = await getDb();
    await db.put('beatmaps', beatMap);
  } catch {
    // Le cache est un confort: son echec ne doit pas empecher l'analyse.
  }
}

/** Analyse en cache, ou `null` si absente ou produite par un ancien algorithme. */
export async function loadBeatMap(assetId: Id): Promise<BeatMap | null> {
  try {
    const db = await getDb();
    const cached = await db.get('beatmaps', assetId);
    if (!cached || isStale(cached, BEAT_ALGO_VERSION)) return null;
    return cached;
  } catch {
    return null;
  }
}

/**
 * Toutes les cles de blobs referencees par les projets stockes.
 *
 * Renvoie `null` si la liste n'a pas pu etre etablie. C'est important: un
 * ensemble vide signifierait "aucun media n'est reference", et le ramasse-
 * miettes supprimerait TOUT. En cas de doute, on ne supprime rien.
 */
export async function referencedMediaKeys(): Promise<Set<string> | null> {
  try {
    const db = await getDb();
    const projects = await db.getAll('projects');
    const keys = new Set<string>();
    for (const project of projects) {
      for (const asset of Object.values(project.assets)) {
        keys.add(asset.storage.key);
      }
    }

    // La bibliotheque personnelle compte comme une reference: ses medias
    // survivent aux projets, et sans cette fusion « Nouveau reel » les
    // supprimerait — c'est precisement ce que la bibliotheque doit empecher.
    const fromLibrary = await libraryMediaKeys();
    if (fromLibrary === null) return null;
    for (const key of fromLibrary) keys.add(key);

    return keys;
  } catch {
    return null;
  }
}
