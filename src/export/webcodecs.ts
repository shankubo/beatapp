/**
 * Pipeline d'export MP4, via WebCodecs et mediabunny.
 *
 * Principe: le rendu est DETERMINISTE, frame par frame. On ne capture pas
 * l'apercu en temps reel (`captureStream`), car cela perd des frames sous
 * charge et depend de la vitesse de l'appareil. Ici, un telephone lent produit
 * exactement le meme fichier, simplement plus lentement.
 *
 * Le dessin passe par `Compositor.draw`, le meme code que l'apercu: c'est la
 * garantie structurelle que le MP4 correspond a ce que l'utilisateur a vu.
 */

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';

import { draw } from '../engine/Compositor';
import { buildScene } from '../engine/SceneGraph';
import type { MediaCache } from '../engine/MediaCache';
import { videoDuration } from '../domain/timeline';
import type { Project, Seconds } from '../domain/types';
import { mixdown, type DecodedAudio } from './audioMix';
import { AAC_CODEC, ExportError, H264_CODEC, probeExportCapability } from './capability';

export type ExportPhase = 'preparing' | 'mixingAudio' | 'encodingVideo' | 'finalizing';

export interface ExportProgress {
  phase: ExportPhase;
  /** Progression globale ponderee, dans [0, 1]. */
  fraction: number;
  /** Estimation du temps restant en secondes, ou `null` si trop tot. */
  etaSeconds: number | null;
}

/**
 * Poids de chaque phase dans la progression globale.
 * Sans ponderation, la barre resterait bloquee a 5% pendant tout l'encodage,
 * qui represente en pratique l'essentiel du temps.
 */
const PHASE_WEIGHTS: Record<ExportPhase, number> = {
  preparing: 0.03,
  mixingAudio: 0.12,
  encodingVideo: 0.8,
  finalizing: 0.05,
};

export interface ExportQuality {
  width: number;
  height: number;
  /** Debit video en bits par seconde. */
  bitrate: number;
}

/**
 * Palier de qualite: une hauteur cible, PAS une paire de dimensions.
 *
 * Le format est desormais choisi par l'utilisateur (9:16, 1:1, 4:5, 16:9), donc
 * la largeur ne peut plus etre figee ici — elle se deduit du ratio du projet.
 * Figer les deux ferait etirer l'image: `Compositor.draw` met X et Y a l'echelle
 * INDEPENDAMMENT, donc un projet carre rendu dans un canvas 9:16 serait deforme,
 * et non encadre.
 */
export interface QualityTier {
  /**
   * HAUTEUR de reference, en pixels — pas « le cote long ».
   *
   * La distinction compte depuis le 4K: en 16:9, `2160` est la hauteur alors que
   * le cote long vaut 3840. Confondre les deux donnerait un 3840 de HAUT, soit
   * du 6827x3840 en paysage.
   */
  height: number;
  bitrate: number;
  /**
   * Palier reserve aux formats plus larges que hauts.
   *
   * Le 4K ne sert qu'a la video classique: en 9:16 il produirait du 2160x3840,
   * que ni Instagram ni TikTok ne diffusent.
   */
  landscapeOnly?: boolean;
}

/** Le palier est-il proposable pour ce format? */
export function tierAppliesTo(
  tier: QualityTier,
  frame: { width: number; height: number },
): boolean {
  return !tier.landscapeOnly || frame.width > frame.height;
}

/** 8 Mbps en 1080x1920: la qualite qu'Instagram accepte sans re-encoder. */
export const QUALITY_HIGH: QualityTier = { height: 1920, bitrate: 8_000_000 };
/** Repli pour les appareils sous pression memoire. */
export const QUALITY_MEDIUM: QualityTier = { height: 1280, bitrate: 4_000_000 };
/**
 * Palier haut, sonde par appareil.
 *
 * 2560 est le cote long d'un 1440p vertical. C'est le palier utile pour un reel:
 * Instagram et WhatsApp re-encodent tout au-dela de 1080x1920, donc y monter plus
 * haut alourdit le fichier sans gain visible chez le spectateur.
 */
export const QUALITY_ULTRA: QualityTier = { height: 2560, bitrate: 14_000_000 };

/**
 * 4K, pour YouTube en 16:9.
 *
 * Longtemps ecarte ici sur la foi de deux croyances, toutes deux FAUSSES et
 * corrigees par la mesure dans Chromium:
 *
 * - « H.264 ne monte pas au 4K ». En realite `avc1.42E028` (Baseline) est bien
 *   refuse en 3840x2160, mais `avc1.640033` (High 5.1) est accepte — et
 *   mediabunny selectionne DEJA ce profil tout seul derriere la chaine `'avc'`.
 *   Aucune modification du codec n'a ete necessaire.
 * - « trop lent / trop lourd ». Mesure: 30 frames en 3840x2160 encodees en
 *   917 ms, soit plus vite que le temps reel, pour un MP4 de 1,1 Mo.
 *
 * Reste vrai en revanche: une frame RGBA 4K pese 33 Mo contre 8 Mo en 1080. D'ou
 * le sondage par appareil, qui masque le palier sur le materiel qui le refuse.
 *
 * `landscapeOnly`: le 4K n'a de sens que pour la video classique. En 9:16 il
 * donnerait 2160x3840, que ni Instagram ni TikTok ne diffusent — le fichier
 * serait quatre fois plus lourd pour etre re-encode a l'arrivee.
 */
export const QUALITY_4K: QualityTier = {
  height: 2160,
  bitrate: 40_000_000,
  landscapeOnly: true,
};

/** Nombre pair immediatement inferieur ou egal, au minimum 2. */
function evenDown(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

/**
 * Dimensions d'encodage: le palier donne la hauteur, le projet donne le ratio.
 *
 * Les deux cotes sont ramenes a un nombre PAIR. H.264 en 4:2:0 sous-echantillonne
 * la chrominance d'un facteur deux; un cote impair fait echouer l'encodeur a
 * l'execution, et l'echec surviendrait apres plusieurs secondes d'export.
 *
 * On ne suragrandit jamais au-dela de la frame du projet quand celle-ci est plus
 * petite que le palier: cela n'ajouterait aucun detail.
 *
 * Fonction PURE: c'est le calcul le plus susceptible d'etre faux, et il est
 * entierement testable sans encodeur.
 */
export function qualityDimensions(
  tier: QualityTier,
  frame: { width: number; height: number },
): ExportQuality {
  const ratio = frame.width / frame.height;
  const height = evenDown(tier.height);
  return {
    width: evenDown(height * ratio),
    height,
    bitrate: tier.bitrate,
  };
}

export interface ExportOptions {
  /** Palier de qualite. Les dimensions en decoulent, via `project.frame`. */
  tier?: QualityTier;
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
  /**
   * Appele avant chaque frame, pour laisser le cache decoder ce qui est
   * necessaire. `MediaCache.frameAt` est synchrone (le compositeur ne peut pas
   * attendre) alors que le decodage video est asynchrone: ce point d'entree est
   * ce qui reconcilie les deux.
   */
  prepareFrame?: (time: Seconds) => Promise<void>;
}

export interface ExportResult {
  blob: Blob;
  durationSeconds: Seconds;
  frameCount: number;
}

/**
 * Suivi de progression avec estimation du temps restant par moyenne mobile
 * exponentielle: une moyenne simple reagit trop lentement aux variations de
 * charge (thermal throttling sur telephone).
 */
class ProgressReporter {
  private emaPerFrame: number | null = null;
  private lastTick = performance.now();

  constructor(private readonly onProgress: ExportOptions['onProgress']) {}

  report(phase: ExportPhase, phaseFraction: number, etaSeconds: number | null = null): void {
    if (!this.onProgress) return;

    // Somme des poids des phases deja terminees, plus la fraction courante.
    let fraction = 0;
    for (const [name, weight] of Object.entries(PHASE_WEIGHTS) as [ExportPhase, number][]) {
      if (name === phase) {
        fraction += weight * phaseFraction;
        break;
      }
      fraction += weight;
    }

    this.onProgress({ phase, fraction: Math.min(1, fraction), etaSeconds });
  }

  /** Enregistre le temps d'une frame et renvoie l'ETA pour les frames restantes. */
  tickFrame(remaining: number): number | null {
    const now = performance.now();
    const elapsed = now - this.lastTick;
    this.lastTick = now;

    // Lissage a 0.2: reagit en une dizaine de frames sans etre nerveux.
    this.emaPerFrame =
      this.emaPerFrame === null ? elapsed : this.emaPerFrame * 0.8 + elapsed * 0.2;

    if (remaining <= 0) return 0;
    return (this.emaPerFrame * remaining) / 1000;
  }
}

/**
 * Exporte un projet en MP4.
 *
 * @param cache Fournisseur de frames. Pour un export exact, passer un cache
 *   base sur un decodage deterministe; pour un apercu rapide, tout cache fait
 *   l'affaire (l'API est la meme, c'est tout l'interet).
 */
export async function exportMp4(
  project: Project,
  cache: MediaCache,
  audioBuffers: DecodedAudio,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const tier = options.tier ?? QUALITY_HIGH;
  const quality = qualityDimensions(tier, project.frame);
  const reporter = new ProgressReporter(options.onProgress);
  const signal = options.signal;

  reporter.report('preparing', 0);

  const duration = videoDuration(project.videoTrack);
  if (duration <= 0) throw new ExportError('errors:export.empty');

  const probe = await probeExportCapability();
  if (probe.capability.kind !== 'mp4') {
    throw new ExportError('errors:export.unsupportedBrowser.title');
  }

  /*
    La qualite demandee doit etre encodable: certains materiels acceptent le
    720x1280 mais refusent le 1080x1920.

    On sonde les dimensions REELLES et non un palier nomme. L'ancien test
    (`quality.width >= QUALITY_HIGH.width`) devient faux des que le format varie:
    un projet carre en 1920 de haut fait 1920 de large et serait classe "ultra"
    alors qu'il tient dans le palier haut. La sonde de `canEncodeVideo` prend de
    toute facon des dimensions, pas un nom.
  */
  if (!(await probe.canEncode(quality.width, quality.height))) {
    throw new ExportError('errors:export.encodeFailed');
  }

  const fps = project.frame.fps;
  const frameCount = Math.ceil(duration * fps);

  signal?.throwIfAborted();
  reporter.report('preparing', 1);

  // --- Audio d'abord: rapide, et cela valide la duree avant l'encodage video.
  reporter.report('mixingAudio', 0);
  const mixed = probe.details.aac ? await mixdown(project, audioBuffers, duration) : null;
  reporter.report('mixingAudio', 1);

  signal?.throwIfAborted();

  // --- Sortie MP4.
  const output = new Output({
    // `fastStart: 'in-memory'` place l'atome moov en tete du fichier, ce
    // qu'Instagram et WhatsApp attendent pour lire sans telecharger le tout.
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });

  const canvas = new OffscreenCanvas(quality.width, quality.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new ExportError('errors:export.encodeFailed');

  const videoSource = new CanvasSource(canvas, {
    codec: H264_CODEC,
    bitrate: quality.bitrate,
    // Une image cle toutes les 2 s: bon compromis entre taille et navigation.
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: fps });

  const audioSource = mixed
    ? new AudioBufferSource({ codec: AAC_CODEC, bitrate: 128_000 })
    : null;
  if (audioSource) output.addAudioTrack(audioSource);

  try {
    await output.start();

    if (audioSource && mixed) {
      await audioSource.add(mixed);
      audioSource.close();
    }

    // --- Boucle video deterministe.
    for (let frame = 0; frame < frameCount; frame += 1) {
      signal?.throwIfAborted();

      const time = frame / fps;
      // Decodage de la frame exacte avant de composer: sans cela, une video
      // apparaitrait figee sur la derniere frame decodee.
      await options.prepareFrame?.(time);
      const scene = buildScene(project, time, cache);
      draw(scene, { ctx, width: quality.width, height: quality.height });

      // `await` est le mecanisme de CONTRE-PRESSION: la promesse ne se resout
      // que quand l'encodeur peut accepter davantage, ce qui borne la memoire.
      // Ne jamais appeler `add` sans l'attendre.
      await videoSource.add(time, 1 / fps);

      // On ne notifie pas a chaque frame: 30 postMessage par seconde de video
      // encombreraient le thread principal pour rien.
      if (frame % 5 === 0 || frame === frameCount - 1) {
        const eta = reporter.tickFrame(frameCount - frame - 1);
        reporter.report('encodingVideo', (frame + 1) / frameCount, eta);
      }
    }

    videoSource.close();

    reporter.report('finalizing', 0);
    await output.finalize();
    reporter.report('finalizing', 1);

    const buffer = output.target.buffer;
    if (!buffer) throw new ExportError('errors:export.encodeFailed');

    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      durationSeconds: duration,
      frameCount,
    };
  } catch (error) {
    // On annule la sortie pour liberer encodeur et memoire, sans masquer
    // l'erreur d'origine.
    await output.cancel().catch(() => undefined);

    if (signal?.aborted) throw error;
    if (error instanceof ExportError) throw error;
    throw wrapEncodeError(error);
  }
}

/** Traduit une erreur technique en erreur utilisateur exploitable. */
function wrapEncodeError(error: unknown): ExportError {
  const message = error instanceof Error ? error.message : String(error);

  // Les navigateurs signalent la pression memoire de facons variees; le nom de
  // l'erreur DOM est le signal le plus fiable.
  const isMemory =
    (error instanceof Error && error.name === 'QuotaExceededError') ||
    /out of memory|allocation failed|memory/i.test(message);

  return new ExportError(isMemory ? 'errors:export.outOfMemory' : 'errors:export.encodeFailed', {}, {
    cause: error,
  });
}
