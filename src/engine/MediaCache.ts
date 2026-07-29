/**
 * Fourniture des frames au SceneGraph.
 *
 * C'est le SEUL endroit ou l'apercu et l'export divergent, et la divergence est
 * volontairement confinee derriere cette interface:
 *
 * - apercu (`RealtimeMediaCache`): des `<video>` caches, rapides et acceleres
 *   materiellement, mais qui ne donnent que la frame "approximativement bonne";
 * - export (`DecodedMediaCache`, dans src/export/): un decodage exact via
 *   mediabunny, deterministe et reproductible.
 *
 * Les images passent par `ImageBitmap` dans les deux cas: leur rendu est donc
 * rigoureusement identique.
 */

import type { Id, MediaAsset, Seconds } from '../domain/types';

export interface FrameSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface MediaCache {
  /**
   * Frame a afficher pour un media a un instant donne de sa SOURCE.
   * Renvoie `null` si rien n'est encore decode (le compositeur saute alors la
   * couche plutot que de dessiner une frame fausse).
   */
  frameAt(assetId: Id, sourceTime: Seconds): FrameSource | null;
  /** Libere toutes les ressources detenues. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Decodage d'images
// ---------------------------------------------------------------------------

/**
 * Decode un blob image en `ImageBitmap`.
 * `ImageBitmap` est utilisable a la fois sur canvas visible et OffscreenCanvas,
 * et son decodage est fait une seule fois — contrairement a `<img>` qui peut
 * etre re-decode a chaque `drawImage` selon le navigateur.
 */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

/**
 * Reduit un `ImageBitmap` a la taille utile pour la frame cible.
 *
 * Une photo de 12 Mpx dessinee dans un cadre de 1080x1920 gaspille de la
 * memoire et du temps de composition a chaque frame. On la redimensionne une
 * fois a l'import. Sur un telephone milieu de gamme, c'est la difference entre
 * 60 fps et des saccades.
 */
export async function downscaleToFrame(
  blob: Blob,
  maxWidth: number,
  maxHeight: number,
): Promise<ImageBitmap> {
  const probe = await createImageBitmap(blob);
  const target = coverSize(probe.width, probe.height, maxWidth, maxHeight);
  if (target.width >= probe.width) return probe;

  const resized = await createImageBitmap(probe, {
    resizeWidth: target.width,
    resizeHeight: target.height,
    resizeQuality: 'high',
  });
  probe.close();
  return resized;
}

/**
 * Budget de pixels apres reduction, en megapixels.
 *
 * Le plafond existe pour un seul cas: une source tres allongee. Couvrir un cadre
 * 9:16 avec une image 3:1 demande 5760x1920, soit 11 Mpx (44 Mo en RGBA) — c'est
 * la que le garde-fou doit mordre.
 *
 * Valeur etablie par la mesure du cout REEL de la couverture, tous formats du
 * selecteur confondus:
 *
 *   2:3 en 9:16 (cas signale)  2,5 Mpx
 *   4:3 en 9:16                4,9 Mpx
 *   reflex 3:2 en 9:16         5,5 Mpx
 *   2:3 en 16:9                5,5 Mpx
 *   panoramique 3:1 en 9:16   11,1 Mpx  <- seul cas a brider
 *
 * MAINTENU a 6 Mpx malgre l'ajout de la marge de zoom, et c'est la mesure qui
 * a tranche. Le cout se paie par media et un montage en compte des dizaines;
 * mesure sur 12 photos d'iPhone (le cas courant), frame 1080x1920:
 *
 *   marge  budget   zoom net   12 images
 *     1,0   6 Mpx      100 %     133 Mo   <- avant ce chantier
 *     1,4   6 Mpx      140 %     260 Mo   <- retenu
 *     1,6   8 Mpx      160 %     340 Mo   <- onglet tue
 *     2,5  12 Mpx      208 %     576 Mo   <- absurde
 *
 * Un onglet mobile est tue vers 300-400 Mo. Monter le budget a 8 ou 12 Mpx
 * achetait donc 20 a 70 % de zoom net supplementaire au prix d'un plantage sur
 * un montage ordinaire — un mauvais echange, la nettete d'une image qu'on ne
 * peut plus afficher ne valant rien.
 */
const MAX_DECODED_MEGAPIXELS = 6;

/**
 * Marge de resolution conservee pour le zoom.
 *
 * Sans elle, une source est reduite a la taille qui couvre la frame a 100 %
 * EXACTEMENT: le moindre zoom reagrandit alors la bitmap, et l'image mollit.
 * C'est ce qui limitait la nettete a 100 % quel que soit le plafond de zoom.
 *
 * 1,4 et non le plafond de zoom (500 %): le cout croit avec le CARRE de la
 * marge. Decoder 5x la couverture demanderait 25 fois plus de pixels — 576 Mo
 * pour douze photos, soit un onglet tue. 1,4 rend 140 % de zoom net pour 260 Mo
 * sur ce meme montage, sous le seuil de 300-400 Mo ou le systeme intervient.
 *
 * Au-dela de 140 % on assume donc l'agrandissement, qui est d'ailleurs souvent
 * l'effet cherche quand on isole un detail. La marge n'est JAMAIS
 * suragrandissante: le `Math.min` a 1 en aval interdit de decoder au-dela de la
 * resolution native, ce qui n'inventerait aucun detail.
 */
const ZOOM_HEADROOM = 1.4;

/**
 * Taille de decodage d'une image destinee a REMPLIR la frame.
 *
 * Le piege corrige ici: un `Math.min` des deux ratios fait tenir l'image DANS la
 * boite, ce qui est juste pour `contain` mais faux pour `cover` — le mode par
 * defaut de l'application. Mesure sur le cas signale: une photo 3456x5184 (2:3)
 * pour une frame 1080x1920 (9:16) tombait a 1080x1620, alors que couvrir la frame
 * exige 1920 px de haut. L'apercu ne disposait donc que de 84 % de la resolution
 * necessaire et reagrandissait, d'ou une image molle — alors que l'export, qui
 * decode en pleine resolution, restait net. Un `Math.max` fait couvrir.
 *
 * Fonction PURE et exportee: c'est de la geometrie, donc testable sans decoder
 * la moindre image.
 */
export function coverSize(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: Math.max(1, frameWidth), height: Math.max(1, frameHeight) };
  }

  // `max`: le plus contraignant des deux axes decide, donc l'image couvre.
  // `ZOOM_HEADROOM` garde de la resolution en reserve pour le zoom.
  // Plafonne a 1: on ne suragrandit jamais une source plus petite que la frame,
  // ce qui n'ajouterait aucun detail et couterait de la memoire.
  let scale = Math.min(
    1,
    Math.max(frameWidth / sourceWidth, frameHeight / sourceHeight) * ZOOM_HEADROOM,
  );

  const budget = MAX_DECODED_MEGAPIXELS * 1_000_000;
  const pixels = sourceWidth * sourceHeight * scale * scale;
  if (pixels > budget) scale *= Math.sqrt(budget / pixels);

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

// ---------------------------------------------------------------------------
// Cache temps reel (apercu)
// ---------------------------------------------------------------------------

interface VideoEntry {
  element: HTMLVideoElement;
  /** Passe a `true` sur `loadeddata`: avant, `videoWidth` vaut 0. */
  ready: boolean;
}

/**
 * Cache pour la lecture temps reel.
 *
 * Les images sont conservees en `ImageBitmap`. Les videos utilisent un pool
 * d'elements `<video>`: en garder un par clip epuiserait la memoire et le
 * nombre de decodeurs materiels (limite a quelques unites sur mobile).
 */
export class RealtimeMediaCache implements MediaCache {
  private readonly images = new Map<Id, ImageBitmap>();
  private readonly videos = new Map<Id, VideoEntry>();
  private readonly objectUrls = new Set<string>();

  /** Tolerance de seek: en dessous, on laisse la video suivre son cours. */
  private static readonly SEEK_EPSILON: Seconds = 0.08;

  registerImage(assetId: Id, bitmap: ImageBitmap): void {
    this.images.get(assetId)?.close();
    this.images.set(assetId, bitmap);
  }

  /**
   * Enregistre une video. L'objectURL est detenu par le cache et revoque dans
   * `dispose()`: une fuite ici garderait le blob en memoire indefiniment.
   */
  registerVideo(assetId: Id, blob: Blob): HTMLVideoElement {
    const existing = this.videos.get(assetId);
    if (existing) return existing.element;

    const url = URL.createObjectURL(blob);
    this.objectUrls.add(url);

    const element = document.createElement('video');
    element.src = url;
    element.muted = true;
    element.playsInline = true;
    element.preload = 'auto';
    // Requis pour lire une video sans interaction sur iOS.
    element.setAttribute('playsinline', '');
    element.crossOrigin = 'anonymous';

    const entry: VideoEntry = { element, ready: false };
    element.addEventListener('loadeddata', () => {
      entry.ready = true;
    });
    this.videos.set(assetId, entry);
    return element;
  }

  hasVideo(assetId: Id): boolean {
    return this.videos.has(assetId);
  }

  frameAt(assetId: Id, sourceTime: Seconds): FrameSource | null {
    const bitmap = this.images.get(assetId);
    if (bitmap) {
      return { image: bitmap, width: bitmap.width, height: bitmap.height };
    }

    const entry = this.videos.get(assetId);
    if (!entry || !entry.ready) return null;

    const { element } = entry;
    // On ne seeke que si l'ecart est significatif: pendant la lecture, la video
    // avance seule et un seek par frame la ferait bafouiller.
    if (Math.abs(element.currentTime - sourceTime) > RealtimeMediaCache.SEEK_EPSILON) {
      element.currentTime = sourceTime;
    }

    if (element.videoWidth === 0) return null;
    return { image: element, width: element.videoWidth, height: element.videoHeight };
  }

  /** Lance la lecture des videos utilisees, pour que l'apercu soit fluide. */
  async playVideos(assetIds: readonly Id[], sourceTimes: readonly Seconds[]): Promise<void> {
    await Promise.all(
      assetIds.map(async (assetId, index) => {
        const entry = this.videos.get(assetId);
        if (!entry) return;
        const target = sourceTimes[index];
        if (target !== undefined) entry.element.currentTime = target;
        try {
          await entry.element.play();
        } catch {
          // Lecture refusee (politique d'autoplay): l'apercu affichera des
          // frames figees, ce qui est degrade mais pas casse.
        }
      }),
    );
  }

  pauseVideos(): void {
    for (const entry of this.videos.values()) entry.element.pause();
  }

  /** Force une position exacte sur toutes les videos (utilise au scrub). */
  seekVideos(positions: ReadonlyMap<Id, Seconds>): void {
    for (const [assetId, time] of positions) {
      const entry = this.videos.get(assetId);
      if (entry) entry.element.currentTime = time;
    }
  }

  dispose(): void {
    for (const bitmap of this.images.values()) bitmap.close();
    this.images.clear();

    for (const entry of this.videos.values()) {
      entry.element.pause();
      entry.element.removeAttribute('src');
      entry.element.load();
    }
    this.videos.clear();

    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }
}

/**
 * Cache trivial a partir de frames deja decodees.
 * Utilise par les tests et par le rendu de vignettes, ou il n'y a rien a
 * decoder dynamiquement.
 */
export class StaticMediaCache implements MediaCache {
  constructor(private readonly frames: Map<Id, FrameSource>) {}

  frameAt(assetId: Id): FrameSource | null {
    return this.frames.get(assetId) ?? null;
  }

  dispose(): void {
    for (const frame of this.frames.values()) {
      if (frame.image instanceof ImageBitmap) frame.image.close();
    }
    this.frames.clear();
  }
}

/** Dimensions intrinseques connues d'un media, avec repli sur la frame. */
export function assetDimensions(
  asset: MediaAsset | undefined,
  fallbackWidth: number,
  fallbackHeight: number,
): { width: number; height: number } {
  return {
    width: asset?.width ?? fallbackWidth,
    height: asset?.height ?? fallbackHeight,
  };
}
