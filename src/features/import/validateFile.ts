/**
 * Validation des fichiers importes.
 *
 * Les fichiers viennent de l'utilisateur et sont traites comme HOSTILES:
 * - on ne fait jamais confiance a `File.type` ni a l'extension (tous deux
 *   librement modifiables): on lit les MAGIC BYTES;
 * - on plafonne la taille avant tout decodage, pour ne pas faire tomber
 *   l'onglet sur un fichier gonfle;
 * - le nom de fichier n'est jamais interprete comme du balisage.
 */

import { MAX_IMPORT_BYTES, type MediaKind } from '../../domain/types';

export interface ValidationSuccess {
  ok: true;
  kind: MediaKind;
  /** Type MIME deduit des octets, et non de `File.type`. */
  mimeType: string;
}

/**
 * Cles d'echec de validation, prefixees de leur namespace.
 * Enumerees plutot que libres: une cle inexistante s'afficherait telle quelle.
 */
export type ValidationErrorKey =
  | 'errors:import.unsupportedType'
  | 'errors:import.corrupted'
  | 'errors:import.tooLarge';

export interface ValidationFailure {
  ok: false;
  i18nKey: ValidationErrorKey;
  params?: Record<string, string | number>;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/** Nombre d'octets suffisant pour identifier tous les formats supportes. */
const SNIFF_BYTES = 32;

interface Signature {
  kind: MediaKind;
  mimeType: string;
  /** Teste les octets de tete. */
  match: (bytes: Uint8Array) => boolean;
}

function startsWith(bytes: Uint8Array, offset: number, pattern: readonly number[]): boolean {
  if (bytes.length < offset + pattern.length) return false;
  return pattern.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  return startsWith(
    bytes,
    offset,
    Array.from(text, (char) => char.charCodeAt(0)),
  );
}

/**
 * Signatures des formats acceptes.
 *
 * On accepte volontairement peu de formats: ce sont ceux que produisent les
 * telephones et que les navigateurs savent decoder de facon fiable.
 */
const SIGNATURES: readonly Signature[] = [
  // --- Images
  { kind: 'image', mimeType: 'image/jpeg', match: (b) => startsWith(b, 0, [0xff, 0xd8, 0xff]) },
  {
    kind: 'image',
    mimeType: 'image/png',
    match: (b) => startsWith(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    kind: 'image',
    mimeType: 'image/webp',
    match: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP'),
  },
  // HEIC/HEIF: format par defaut des iPhone.
  {
    kind: 'image',
    mimeType: 'image/heic',
    match: (b) => ascii(b, 4, 'ftyp') && (ascii(b, 8, 'heic') || ascii(b, 8, 'heix') || ascii(b, 8, 'mif1')),
  },
  { kind: 'image', mimeType: 'image/gif', match: (b) => ascii(b, 0, 'GIF8') },
  { kind: 'image', mimeType: 'image/avif', match: (b) => ascii(b, 4, 'ftyp') && ascii(b, 8, 'avif') },

  // --- Videos
  // MP4 et QuickTime partagent la boite `ftyp`; on les distingue par la marque.
  {
    kind: 'video',
    mimeType: 'video/mp4',
    match: (b) =>
      ascii(b, 4, 'ftyp') &&
      (ascii(b, 8, 'isom') ||
        ascii(b, 8, 'iso2') ||
        ascii(b, 8, 'mp41') ||
        ascii(b, 8, 'mp42') ||
        ascii(b, 8, 'avc1') ||
        ascii(b, 8, 'M4V ') ||
        ascii(b, 8, 'dash')),
  },
  { kind: 'video', mimeType: 'video/quicktime', match: (b) => ascii(b, 4, 'ftyp') && ascii(b, 8, 'qt  ') },
  // WebM et MKV partagent l'entete EBML.
  {
    kind: 'video',
    mimeType: 'video/webm',
    match: (b) => startsWith(b, 0, [0x1a, 0x45, 0xdf, 0xa3]),
  },

  // --- Audio
  { kind: 'audio', mimeType: 'audio/mpeg', match: (b) => startsWith(b, 0, [0xff, 0xfb]) || startsWith(b, 0, [0xff, 0xf3]) || startsWith(b, 0, [0xff, 0xf2]) },
  // MP3 avec tag ID3 en tete.
  { kind: 'audio', mimeType: 'audio/mpeg', match: (b) => ascii(b, 0, 'ID3') },
  { kind: 'audio', mimeType: 'audio/wav', match: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE') },
  { kind: 'audio', mimeType: 'audio/flac', match: (b) => ascii(b, 0, 'fLaC') },
  { kind: 'audio', mimeType: 'audio/ogg', match: (b) => ascii(b, 0, 'OggS') },
  {
    kind: 'audio',
    mimeType: 'audio/mp4',
    match: (b) => ascii(b, 4, 'ftyp') && (ascii(b, 8, 'M4A ') || ascii(b, 8, 'mp4a')),
  },
];

/**
 * Identifie un fichier par ses octets de tete.
 *
 * L'ordre compte: les signatures `ftyp` audio (M4A) sont testees avant la
 * signature video generique, car elles partagent la meme boite.
 */
export async function sniffFile(file: File): Promise<ValidationSuccess | null> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());

  // On teste d'abord les signatures les plus specifiques (audio/image en `ftyp`)
  // puis les plus generiques.
  const audioFirst = [
    ...SIGNATURES.filter((s) => s.kind === 'audio'),
    ...SIGNATURES.filter((s) => s.kind === 'image'),
    ...SIGNATURES.filter((s) => s.kind === 'video'),
  ];

  for (const signature of audioFirst) {
    if (signature.match(head)) {
      return { ok: true, kind: signature.kind, mimeType: signature.mimeType };
    }
  }

  return null;
}

/** Valide taille puis contenu. Ne decode rien: c'est le role de l'appelant. */
export async function validateFile(
  file: File,
  options: { maxBytes?: number; accept?: readonly MediaKind[] } = {},
): Promise<ValidationResult> {
  const maxBytes = options.maxBytes ?? MAX_IMPORT_BYTES;

  if (file.size === 0) {
    return { ok: false, i18nKey: 'errors:import.corrupted' };
  }

  // La taille est verifiee AVANT toute lecture: un fichier de 2 Go ne doit pas
  // meme etre effleure.
  if (file.size > maxBytes) {
    return {
      ok: false,
      i18nKey: 'errors:import.tooLarge',
      params: { maxMb: Math.round(maxBytes / (1024 * 1024)) },
    };
  }

  const sniffed = await sniffFile(file);
  if (!sniffed) {
    return { ok: false, i18nKey: 'errors:import.unsupportedType' };
  }

  if (options.accept && !options.accept.includes(sniffed.kind)) {
    return { ok: false, i18nKey: 'errors:import.unsupportedType' };
  }

  return sniffed;
}

/**
 * Nettoie un nom de fichier pour l'affichage.
 *
 * Retire les caracteres de controle et les separateurs de chemin, et borne la
 * longueur. Le nom est ensuite rendu comme du TEXTE (jamais du HTML), donc
 * ceci releve de la propriete d'affichage plus que de la securite — mais les
 * deux vont ensemble.
 */
export function sanitizeFileName(name: string, maxLength = 120): string {
  const cleaned = Array.from(name)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      // Caracteres de controle C0/C1, et separateurs de chemin.
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
      return char !== '/' && char !== '\\';
    })
    .join('')
    .trim();

  const fallback = 'media';
  const safe = cleaned.length > 0 ? cleaned : fallback;
  return safe.length > maxLength ? safe.slice(0, maxLength) : safe;
}

/** Attribut `accept` pour un input fichier, a partir des types acceptes. */
export function acceptAttribute(kinds: readonly MediaKind[]): string {
  const map: Record<MediaKind, string> = {
    image: 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,image/gif',
    video: 'video/mp4,video/quicktime,video/webm',
    audio: 'audio/mpeg,audio/wav,audio/flac,audio/ogg,audio/mp4,audio/aac',
  };
  return kinds.map((kind) => map[kind]).join(',');
}
