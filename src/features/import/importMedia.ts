/**
 * Import de medias: validation, sondage des metadonnees, stockage.
 *
 * Toutes les erreurs remontees sont des cles i18n: cette couche ne fabrique
 * jamais de message affichable, c'est le role de l'UI.
 */

import { putMedia } from '../../storage/mediaStore';
import { sanitizeFileName, validateFile } from './validateFile';
import { newId } from '../../lib/id';
import {
  MAX_IMPORT_DURATION,
  type MediaAsset,
  type MediaKind,
  type Seconds,
} from '../../domain/types';

/**
 * Cles d'erreur d'import, enumerees pour rester verifiables a la compilation.
 * Elles correspondent aux entrees du namespace `errors`.
 */
export type ImportErrorKey =
  | 'errors:import.unsupportedType'
  | 'errors:import.corrupted'
  | 'errors:import.tooLarge'
  | 'errors:import.tooLong'
  | 'errors:import.decodeFailed'
  | 'errors:import.noFileSelected';

/** Erreur d'import portant une cle du namespace `errors`. */
export class ImportError extends Error {
  constructor(
    readonly i18nKey: ImportErrorKey,
    readonly params: Record<string, string | number> = {},
    options?: { cause?: unknown },
  ) {
    super(i18nKey, options);
    this.name = 'ImportError';
  }
}

export interface ImportedMedia {
  asset: MediaAsset;
  /** Blob conserve en memoire pour un affichage immediat, sans relire le disque. */
  blob: Blob;
}

/**
 * Importe un fichier.
 *
 * L'ordre des operations est deliberé: on valide (taille puis magic bytes)
 * AVANT de sonder les metadonnees, et on ne stocke qu'un fichier dont on a
 * confirme qu'il est decodable. Un fichier corrompu n'occupe donc jamais
 * l'espace de stockage de l'utilisateur.
 */
export async function importFile(
  file: File,
  options: { accept?: readonly MediaKind[]; maxDuration?: Seconds } = {},
): Promise<ImportedMedia> {
  const validation = await validateFile(file, { accept: options.accept });
  if (!validation.ok) {
    // La cle vient deja typee de `validateFile`: aucune assertion necessaire.
    throw new ImportError(validation.i18nKey, validation.params ?? {});
  }

  const { kind, mimeType } = validation;
  const maxDuration = options.maxDuration ?? MAX_IMPORT_DURATION;

  const metadata = await probeMetadata(file, kind);

  if (metadata.duration !== undefined && metadata.duration > maxDuration) {
    throw new ImportError('errors:import.tooLong', {
      maxMinutes: Math.round(maxDuration / 60),
    });
  }

  const assetId = newId('asset');
  // La cle de stockage est independante du nom fourni par l'utilisateur.
  const storage = await putMedia(`${assetId}.bin`, file);

  const asset: MediaAsset = {
    id: assetId,
    kind,
    name: sanitizeFileName(file.name),
    mimeType,
    bytes: file.size,
    storage,
    createdAt: Date.now(),
    ...metadata,
  };

  return { asset, blob: file };
}

interface ProbedMetadata {
  width?: number;
  height?: number;
  duration?: Seconds;
  /** Vrai si une video porte une piste sonore. Absent pour image et audio. */
  hasAudio?: boolean;
}

async function probeMetadata(file: File, kind: MediaKind): Promise<ProbedMetadata> {
  try {
    if (kind === 'image') return await probeImage(file);
    // mediabunny lit les entetes du conteneur sans tout decoder.
    return await probeWithMediabunny(file, kind);
  } catch (error) {
    // On preserve une ImportError deja qualifiee (p. ex. `import.corrupted`)
    // plutot que de la remplacer par un message plus vague.
    if (error instanceof ImportError) throw error;
    throw new ImportError('errors:import.decodeFailed', {}, { cause: error });
  }
}

async function probeImage(file: File): Promise<ProbedMetadata> {
  // `createImageBitmap` echoue proprement sur une image corrompue, la ou un
  // `<img>` resterait silencieusement en erreur.
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();
  return { width, height };
}

async function probeWithMediabunny(file: File, kind: MediaKind): Promise<ProbedMetadata> {
  // Import dynamique: mediabunny pese plusieurs centaines de kilo-octets et
  // n'est utile qu'au sondage d'un fichier audio/video. Le charger a la demande
  // garde le demarrage de la PWA leger — ce qui compte sur un reseau mobile.
  const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

  const duration = await input.computeDuration();
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new ImportError('errors:import.corrupted');
  }

  if (kind === 'audio') {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new ImportError('errors:import.corrupted');
    return { duration };
  }

  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new ImportError('errors:import.corrupted');

  // Presence d'une piste sonore dans la video. Sondee ICI parce que le fichier
  // est deja ouvert: rouvrir le conteneur plus tard pour la meme information
  // couterait un second parcours complet.
  const audio = await input.getPrimaryAudioTrack();

  return {
    width: track.displayWidth,
    height: track.displayHeight,
    duration,
    hasAudio: audio !== null,
  };
}

/**
 * Importe plusieurs fichiers, en signalant les echecs individuellement.
 *
 * Un fichier invalide au milieu d'une selection de vingt photos ne doit pas
 * faire echouer les dix-neuf autres.
 */
export interface BatchImportResult {
  imported: ImportedMedia[];
  failures: {
    fileName: string;
    i18nKey: ImportErrorKey;
    params: Record<string, string | number>;
  }[];
}

export async function importFiles(
  files: readonly File[],
  options: { accept?: readonly MediaKind[]; maxDuration?: Seconds } = {},
): Promise<BatchImportResult> {
  const imported: ImportedMedia[] = [];
  const failures: BatchImportResult['failures'] = [];

  // Import sequentiel: vingt decodages d'images simultanes saturent la memoire
  // d'un telephone milieu de gamme.
  for (const file of files) {
    try {
      imported.push(await importFile(file, options));
    } catch (error) {
      failures.push({
        fileName: sanitizeFileName(file.name),
        i18nKey: error instanceof ImportError ? error.i18nKey : 'errors:import.decodeFailed',
        params: error instanceof ImportError ? error.params : {},
      });
    }
  }

  return { imported, failures };
}
