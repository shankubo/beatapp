/**
 * Import d'un media depuis une adresse web.
 *
 * CE QUI MARCHE ET CE QUI NE MARCHE PAS
 *
 * Un navigateur ne peut telecharger un fichier depuis un autre domaine que si ce
 * domaine l'autorise explicitement par un en-tete CORS. Instagram, TikTok et
 * YouTube ne l'autorisent pas: la requete echoue avant meme qu'un octet arrive,
 * et AUCUN code cote client ne contourne cela. Il faudrait un serveur relais —
 * ce qui contredirait la promesse « rien ne quitte votre appareil » et les
 * conditions d'utilisation de ces sites.
 *
 * On detecte donc ces domaines AVANT la requete pour expliquer quoi faire
 * (enregistrer dans la pellicule, puis importer le fichier), au lieu de laisser
 * l'utilisateur face a un echec reseau incomprehensible.
 *
 * Le fichier telecharge repasse par `importFile`: il subit exactement la meme
 * validation par magic bytes et les memes plafonds qu'un fichier choisi a la
 * main. Une adresse distante n'est pas plus digne de confiance qu'un fichier
 * local — elle l'est moins.
 */

import { ImportError, importFile, type ImportedMedia } from './importMedia';
import { MAX_IMPORT_BYTES, type MediaKind, type Seconds } from '../../domain/types';

export type UrlImportErrorKey =
  | 'errors:url.invalid'
  | 'errors:url.blockedHost'
  | 'errors:url.fetchFailed'
  | 'errors:url.notMedia'
  | 'errors:url.insecure';

export class UrlImportError extends Error {
  constructor(
    readonly i18nKey: UrlImportErrorKey,
    readonly params: Record<string, string | number> = {},
    options?: { cause?: unknown },
  ) {
    super(i18nKey, options);
    this.name = 'UrlImportError';
  }
}

/**
 * Domaines connus pour bloquer l'acces direct.
 *
 * La liste n'est pas une mesure de securite — elle sert a produire un message
 * utile. Un domaine absent de la liste echouera simplement avec
 * `errors:url.fetchFailed`.
 */
const BLOCKED_HOSTS = [
  'instagram.com',
  'cdninstagram.com',
  'facebook.com',
  'fb.watch',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  'snapchat.com',
  'pinterest.com',
];

/** Vrai si l'hote est `domain` ou l'un de ses sous-domaines. */
function matchesHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isBlockedMediaHost(raw: string): boolean {
  try {
    const { hostname } = new URL(raw);
    const host = hostname.toLowerCase();
    return BLOCKED_HOSTS.some((domain) => matchesHost(host, domain));
  } catch {
    return false;
  }
}

/**
 * Valide l'adresse fournie.
 *
 * Seul `https` est accepte: en `http`, le contenu serait bloque comme contenu
 * mixte sur une PWA servie en https, et transiterait en clair. On rejette aussi
 * `blob:`, `data:` et `file:`, qui n'ont rien a faire dans un champ de saisie.
 */
function parseUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new UrlImportError('errors:url.invalid');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UrlImportError('errors:url.invalid');
  }

  if (url.protocol === 'http:') throw new UrlImportError('errors:url.insecure');
  if (url.protocol !== 'https:') throw new UrlImportError('errors:url.invalid');

  return url;
}

/** Dernier segment du chemin, utilisable comme nom de fichier. */
function fileNameFromUrl(url: URL): string {
  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  const last = segments[segments.length - 1];
  // Sans nom exploitable, on en fabrique un: `importFile` l'assainit ensuite, et
  // le type reel vient des magic bytes, pas de l'extension.
  if (!last || !last.includes('.')) return 'import';
  return decodeURIComponent(last);
}

export interface UrlImportOptions {
  accept?: readonly MediaKind[];
  maxDuration?: Seconds;
  signal?: AbortSignal;
}

/**
 * Telecharge puis importe un media.
 *
 * Le `Content-Length` est verifie avant de lire le corps quand il est present:
 * cela evite de telecharger 800 Mo pour les refuser ensuite. Ce n'est qu'une
 * optimisation — le plafond reel est applique par `importFile` sur le blob.
 */
export async function importFromUrl(
  raw: string,
  options: UrlImportOptions = {},
): Promise<ImportedMedia> {
  const url = parseUrl(raw);

  if (isBlockedMediaHost(url.href)) {
    throw new UrlImportError('errors:url.blockedHost');
  }

  let response: Response;
  try {
    response = await fetch(url.href, {
      // `cors` explicite: en `no-cors` on recevrait une reponse opaque, dont le
      // blob serait vide — un echec silencieux, bien pire qu'une erreur claire.
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: options.signal,
    });
  } catch (error) {
    // Une erreur CORS se presente comme un `TypeError` indistinct: on ne peut
    // pas en dire plus a l'utilisateur que « le site refuse ».
    throw new UrlImportError('errors:url.fetchFailed', {}, { cause: error });
  }

  if (!response.ok) {
    throw new UrlImportError('errors:url.fetchFailed', { status: response.status });
  }

  const declaredLength = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMPORT_BYTES) {
    throw new ImportError('errors:import.tooLarge', {
      maxMb: Math.round(MAX_IMPORT_BYTES / (1024 * 1024)),
    });
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch (error) {
    throw new UrlImportError('errors:url.fetchFailed', {}, { cause: error });
  }

  if (blob.size === 0) throw new UrlImportError('errors:url.notMedia');

  // Le type est determine par `importFile` a partir des magic bytes; le
  // `Content-Type` du serveur n'est pas digne de confiance et n'est pas utilise.
  const file = new File([blob], fileNameFromUrl(url), {
    type: blob.type || 'application/octet-stream',
  });

  return importFile(file, {
    accept: options.accept,
    maxDuration: options.maxDuration,
  });
}
