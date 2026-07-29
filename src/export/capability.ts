/**
 * Detection de la capacite d'export.
 *
 * Beatapp encode en H.264 via WebCodecs, cote client. C'est disponible sur
 * Chrome/Edge, Chrome Android et Safari 26+, soit la grande majorite des
 * utilisateurs — mais pas partout. On le detecte AVANT de laisser l'utilisateur
 * monter un reel entier, et on lui dit clairement quoi faire sinon.
 */

export type ExportCapability =
  | { kind: 'mp4' }
  /** Pas de H.264, mais MediaRecorder existe: WebM possible, sans Instagram. */
  | { kind: 'webm-only' }
  | { kind: 'none' };

export interface ExportProbeResult {
  capability: ExportCapability;
  /** Details pour le diagnostic, non affiches a l'utilisateur. */
  details: {
    webCodecsPresent: boolean;
    h264: boolean;
    aac: boolean;
    mediaRecorder: boolean;
  };
  /**
   * Resolutions effectivement encodables.
   *
   * Un materiel peut refuser le 1080x1920 tout en acceptant le 720x1280 (cas
   * observe sur du materiel de bureau courant). Sans cette distinction, l'app
   * annoncerait « export impossible » alors qu'une qualite reste disponible.
   *
   * Sondees en 9:16, le format par defaut. Pour un autre format il faut passer
   * par `canEncode`: la largeur change avec le ratio, et un appareil peut
   * accepter 1080x1920 tout en refusant 1920x1920.
   */
  supported: { high: boolean; medium: boolean; ultra: boolean; uhd: boolean };
  /**
   * Sonde une paire de dimensions PRECISE.
   *
   * Necessaire depuis que le format de sortie est choisi par l'utilisateur: le
   * couple (palier, format) produit des dimensions que la sonde initiale ne peut
   * pas toutes enumerer a l'avance. Memoise par dimensions.
   */
  canEncode: (width: number, height: number) => Promise<boolean>;
}

/** H.264 Baseline niveau 3.1: le profil qu'Instagram et WhatsApp ingerent. */
export const H264_CODEC = 'avc';
export const AAC_CODEC = 'aac';

let cached: ExportProbeResult | null = null;

/**
 * Resolutions sondees d'emblee, en 9:16 (le format par defaut).
 *
 * Les autres formats passent par `canEncode`, qui sonde a la demande: enumerer
 * ici les quatre formats x trois paliers ferait douze appels a l'ouverture de
 * l'ecran d'export, dont onze inutiles.
 */
const PROBE_SIZES = {
  // Le 4K se sonde en PAYSAGE: c'est le seul format ou il est propose.
  uhd: { width: 3840, height: 2160 },
  ultra: { width: 1440, height: 2560 },
  high: { width: 1080, height: 1920 },
  medium: { width: 720, height: 1280 },
} as const;

/** Memoisation par dimensions, partagee par la sonde initiale et `canEncode`. */
const encodableCache = new Map<string, boolean>();

async function probeSize(width: number, height: number): Promise<boolean> {
  const key = `${width}x${height}`;
  const known = encodableCache.get(key);
  if (known !== undefined) return known;

  let result = false;
  try {
    const { canEncodeVideo } = await import('mediabunny');
    // mediabunny interroge directement WebCodecs: pas de liste codee en dur.
    // Une exception signifie "non supporte", pas une panne.
    result = await canEncodeVideo(H264_CODEC, { width, height });
  } catch {
    result = false;
  }

  encodableCache.set(key, result);
  return result;
}

export async function probeExportCapability(): Promise<ExportProbeResult> {
  if (cached) return cached;

  const webCodecsPresent =
    typeof globalThis.VideoEncoder === 'function' && typeof globalThis.AudioEncoder === 'function';

  const supported = { high: false, medium: false, ultra: false, uhd: false };
  let aac = false;

  if (webCodecsPresent) {
    for (const [name, size] of Object.entries(PROBE_SIZES) as [
      keyof typeof PROBE_SIZES,
      { width: number; height: number },
    ][]) {
      supported[name] = await probeSize(size.width, size.height);
    }

    try {
      // Import dynamique: la sonde est le premier contact avec mediabunny, et
      // elle n'a lieu qu'a l'ouverture de l'ecran d'export.
      const { canEncodeAudio } = await import('mediabunny');
      aac = await canEncodeAudio(AAC_CODEC);
    } catch {
      aac = false;
    }
  }

  // Une seule resolution encodable suffit a rendre l'export possible.
  const h264 = supported.high || supported.medium || supported.ultra || supported.uhd;

  const mediaRecorder =
    typeof globalThis.MediaRecorder === 'function' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function';

  // L'audio AAC n'est pas indispensable: un reel sans musique reste exportable
  // en MP4, et c'est mieux que de tout refuser.
  const capability: ExportCapability = h264
    ? { kind: 'mp4' }
    : mediaRecorder
      ? { kind: 'webm-only' }
      : { kind: 'none' };

  cached = {
    capability,
    details: { webCodecsPresent, h264, aac, mediaRecorder },
    supported,
    canEncode: webCodecsPresent
      ? (width, height) => probeSize(width, height)
      : // Sans WebCodecs, rien n'est encodable: on repond sans interroger
        // mediabunny, dont l'import echouerait de toute facon.
        () => Promise.resolve(false),
  };
  return cached;
}

/** Reinitialise la sonde (tests uniquement). */
export function resetCapabilityCache(): void {
  cached = null;
  encodableCache.clear();
}

/**
 * Cles d'erreur d'export, enumerees pour rester verifiables a la compilation:
 * une cle inexistante s'afficherait sinon telle quelle a l'utilisateur.
 */
export type ExportErrorKey =
  | 'errors:export.empty'
  | 'errors:export.encodeFailed'
  | 'errors:export.outOfMemory'
  | 'errors:export.interrupted'
  | 'errors:export.unsupportedBrowser.title';

/**
 * Erreur d'export destinee a l'utilisateur.
 * `i18nKey` pointe vers une cle du namespace `errors`, jamais un message brut:
 * la couche UI est seule responsable de la traduction.
 */
export class ExportError extends Error {
  constructor(
    readonly i18nKey: ExportErrorKey,
    readonly params: Record<string, string | number> = {},
    options?: { cause?: unknown },
  ) {
    super(i18nKey, options);
    this.name = 'ExportError';
  }
}

export class UnsupportedExportError extends ExportError {
  constructor() {
    super('errors:export.unsupportedBrowser.title');
    this.name = 'UnsupportedExportError';
  }
}
