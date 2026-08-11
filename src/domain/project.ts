/**
 * Fabriques et migration de projet. Module PUR.
 *
 * Le nom du projet est fourni par l'appelant (deja traduit): le domaine ne
 * connait pas i18next.
 */

import {
  FONT_STACKS,
  FRAME_FPS,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  PROJECT_SCHEMA_VERSION,
  type AudioRole,
  type BeatDivision,
  type Clip,
  type ClipFilter,
  type ClipTransform,
  type FilterPreset,
  type FontChoice,
  type Id,
  type ImportPreferences,
  type KenBurns,
  type Lyrics,
  type MediaAsset,
  type NormUnit,
  type ProjectBackground,
  type Project,
  type Seconds,
  type TextMask,
  type TextOverlay,
  type TextPreset,
  type TextStyle,
} from './types';
import { appendClip, insertClip, ripple } from './timeline';
import { newId } from '../lib/id';
import { clamp } from '../lib/math';

/** Duree par defaut d'une photo ajoutee au montage. */
export const DEFAULT_SLIDE_DURATION: Seconds = 2;

/** Duree par defaut d'un texte ajoute. */
export const DEFAULT_TEXT_DURATION: Seconds = 3;

/**
 * Duree minimale d'une incrustation issue d'une coupe.
 *
 * Un fragment plus court serait illisible: le lecteur n'aurait pas le temps de
 * lire le texte avant qu'il disparaisse.
 */
export const MIN_TEXT_DURATION: Seconds = 0.3;

/**
 * Coupe une incrustation en deux a l'instant `at`.
 *
 * Le TEXTE est duplique, pas partage: rien ne permet de deviner ou couper une
 * phrase, et deviner produirait un resultat absurde. Les deux morceaux affichent
 * donc le meme texte sur deux intervalles successifs — ce qui est exactement ce
 * qu'on veut pour ensuite en modifier un seul, ou en supprimer un.
 *
 * Renvoie `null` si la coupe n'est pas possible: hors de l'incrustation, ou si un
 * morceau tomberait sous la duree lisible.
 */
export function splitTextOverlay(
  overlay: TextOverlay,
  at: Seconds,
  newId: Id,
): [TextOverlay, TextOverlay] | null {
  const into = at - overlay.start;
  if (into < MIN_TEXT_DURATION) return null;
  if (overlay.duration - into < MIN_TEXT_DURATION) return null;

  const first: TextOverlay = { ...overlay, duration: into };
  const second: TextOverlay = {
    ...overlay,
    id: newId,
    start: at,
    duration: overlay.duration - into,
    // L'animation d'entree reste sur le PREMIER morceau. La rejouer au milieu
    // d'un texte deja affiche se verrait comme un clignotement.
    animation: { ...overlay.animation, in: 'none' },
  };

  return [first, second];
}

/**
 * Bornes du recadrage d'un clip.
 *
 * Ici et non dans un composant: le panneau Modifier ET le geste de recadrage
 * direct sur l'apercu doivent contraindre les memes valeurs. Deux jeux de
 * bornes divergents laisseraient le geste produire un cadrage que les curseurs
 * ne sauraient pas representer.
 */
/**
 * 5 = 500 %.
 *
 * Monte de 250 % apres mesure. Le point important, contre-intuitif: au-dela de
 * 100 % le zoom n'ajoute JAMAIS de detail, quelle que soit la borne. Mesure sur
 * une frame 1080x1920, en comparant la taille decodee a la taille dessinee:
 *
 *   iPhone 12 Mpx (3024x4032)   net jusqu'a 100 %
 *   Reflex 24 Mpx (6000x4000)   net jusqu'a 100 %
 *   Photo 3456x5184             net jusqu'a 100 %
 *   Video 4K                    net jusqu'a  96 %
 *
 * `coverSize` reduit en effet chaque source a ce qu'il faut pour COUVRIR la
 * frame, pas davantage: zoomer reagrandit ensuite cette bitmap. Le plafond est
 * donc un choix de cadrage, pas une limite technique — 250 % ne protegeait
 * aucune nettete que 500 % perdrait. A 500 %, un pixel source couvre 5 px de
 * frame; c'est assumé, c'est l'effet recherche quand on isole un detail.
 */
export const MAX_CLIP_SCALE = 5;
/** 0.2 = 20 %: permet le dezoom (bandes noires autour de l'image). */
export const MIN_CLIP_SCALE = 0.2;

/**
 * Decalage maximal quand les dimensions de la source sont INCONNUES.
 *
 * Ce n'est qu'un repli: des que la source est connue, `offsetLimitFor` calcule
 * une borne qui suit le debordement reel. Voir la note de cette fonction pour le
 * probleme mesure qu'un plafond fixe posait.
 */
export const MAX_CLIP_OFFSET = 0.4;

/**
 * Decalage maximal permettant d'atteindre le bord de l'image, sans plus.
 *
 * Le plafond fixe de 0,4 etait faux des qu'on zoomait: le compositeur agrandit
 * autour du CENTRE, donc plus on zoome, plus l'image deborde et plus il faut
 * pouvoir la deplacer. Part de l'image reellement atteignable, mesuree en
 * cadre 1080x1920 avec l'ancienne borne:
 *
 *                          1x     2x     3x     5x
 *   photo 3:4 (3024x4032)  100 %   48 %   27 %   14 %
 *   video 1080p            100 %   80 %   40 %   20 %
 *   paysage 3:2 en 9:16     48 %   18 %   11 %    6 %
 *
 * Le paysage 3:2 montre que le defaut ne datait PAS du zoom eleve: une photo
 * horizontale dans un cadre vertical etait deja bloquee a 100 %, ses bords
 * gauche et droit inaccessibles.
 *
 * La borne suit donc le debordement: `(dessine - cadre) / 2`, en fraction du
 * cadre. Elle vaut zero quand l'image ne deborde pas — un plan en `contain`
 * centre n'a aucune raison de glisser hors du cadre, et l'y autoriser ne
 * ferait qu'ouvrir du fond vide.
 *
 * Le minimum a `MAX_CLIP_OFFSET` garde l'ancien jeu disponible: en `contain`,
 * decaler volontairement une image pour composer avec du fond reste legitime.
 */
export function offsetLimitFor(
  source: { width: number; height: number } | undefined,
  frame: { width: number; height: number },
  fit: 'cover' | 'contain',
  scale: number,
): { x: number; y: number } {
  if (
    !source ||
    !(source.width > 0) ||
    !(source.height > 0) ||
    !(frame.width > 0) ||
    !(frame.height > 0) ||
    !Number.isFinite(scale)
  ) {
    return { x: MAX_CLIP_OFFSET, y: MAX_CLIP_OFFSET };
  }

  // Meme geometrie que `fitRect` dans le compositeur: c'est ce qui garantit que
  // la borne correspond a ce qui est REELLEMENT dessine.
  const ratio =
    fit === 'cover'
      ? Math.max(frame.width / source.width, frame.height / source.height)
      : Math.min(frame.width / source.width, frame.height / source.height);

  const drawnWidth = source.width * ratio * Math.abs(scale);
  const drawnHeight = source.height * ratio * Math.abs(scale);

  return {
    x: Math.max(MAX_CLIP_OFFSET, (drawnWidth - frame.width) / 2 / frame.width),
    y: Math.max(MAX_CLIP_OFFSET, (drawnHeight - frame.height) / 2 / frame.height),
  };
}

/** Quart de tour, en radians. */
export const QUARTER_TURN = Math.PI / 2;
export const FULL_TURN = 2 * Math.PI;

/**
 * Inclinaison maximale, en radians (~20 degres).
 *
 * Volontairement etroite: au-dela, une image inclinee ne se lit plus comme un
 * effet mais comme une erreur, et les coins vides deviennent enormes. Redresser
 * une photo couchee releve du quart de tour, pas de ce curseur.
 */
export const MAX_CLIP_TILT = 0.35;

/**
 * Rotation ramenee dans [0, 2*PI[.
 *
 * Sans cette normalisation, tourner quatre fois dans le meme sens accumulerait
 * 2*PI et le bouton « reinitialiser » deviendrait le seul moyen de revenir a
 * zero, alors que l'image est visuellement identique.
 */
export function normalizeRotation(rotation: number): number {
  if (!Number.isFinite(rotation)) return 0;
  const wrapped = rotation % FULL_TURN;
  return wrapped < 0 ? wrapped + FULL_TURN : wrapped;
}

/**
 * Decompose une rotation en (quarts de tour, inclinaison).
 *
 * L'interface expose deux reglages distincts alors que le MODELE n'en porte
 * qu'un: `transform.rotation`. Cette fonction est la charniere entre les deux.
 *
 * Un seul champ est conserve a dessein — le compositeur applique une seule
 * `ctx.rotate` ([Compositor.ts:193]), et stocker deux angles obligerait a les
 * additionner partout, avec le risque d'en oublier un.
 *
 * L'inclinaison est prise dans [-PI/4, PI/4[: au-dela, c'est le quart de tour
 * voisin qui est le plus proche. Elle reste donc toujours la plus petite
 * correction visuelle possible.
 */
export function splitRotation(rotation: number): { quarters: number; tilt: number } {
  const normalized = normalizeRotation(rotation);

  /*
    Le quart le plus proche est calcule AVANT le repli modulo 4, puis le repli est
    applique au seul numero de quart.

    Piege mesure: replier d'abord donnait `Math.round(6.18 / (PI/2)) % 4 === 0`
    pour une inclinaison de -0,1 rad, et l'ecart se retrouvait dans `tilt` sous la
    forme +6,18 rad — soit une inclinaison hors bornes, que le curseur ne pouvait
    pas representer. Un aller-retour split/join perdait alors la valeur.
  */
  const nearest = Math.round(normalized / QUARTER_TURN);
  const tilt = normalized - nearest * QUARTER_TURN;
  const quarters = ((nearest % 4) + 4) % 4;

  return { quarters, tilt };
}

/** Recompose une rotation a partir de quarts de tour et d'une inclinaison. */
export function joinRotation(quarters: number, tilt: number): number {
  const bounded = clamp(tilt, -MAX_CLIP_TILT, MAX_CLIP_TILT);
  return normalizeRotation(quarters * QUARTER_TURN + bounded);
}

/**
 * Facteur de zoom par pression sur les boutons de l'apercu.
 *
 * 1,15 et non 1,25 comme la timeline: zoomer un plan est un CADRAGE, pas une
 * navigation. Un pas trop large fait sortir le sujet du cadre et oblige a
 * corriger la position ensuite. Mesure depuis 100 %: 7 pressions atteignent le
 * maximum (250 %), 12 le minimum (20 %) — assez fin pour ajuster, assez rapide
 * pour parcourir toute la plage sans s'acharner.
 */
export const CLIP_ZOOM_STEP = 1.15;

/**
 * Echelle apres une pression de zoom, bornee.
 *
 * Dans le domaine et non dans le composant: c'est la meme regle pour les
 * boutons de l'apercu et pour tout futur raccourci clavier, et une regle de
 * cadrage dupliquee finit toujours par diverger.
 */
export function steppedScale(scale: number, direction: 1 | -1): number {
  // Une valeur non finie ramenee a 1 plutot que propagee: `NaN * 1.15` reste
  // `NaN`, traverserait `clamp` sans etre attrape et ferait disparaitre l'image.
  const base = Number.isFinite(scale) ? scale : 1;
  const factor = direction === 1 ? CLIP_ZOOM_STEP : 1 / CLIP_ZOOM_STEP;
  return clamp(base * factor, MIN_CLIP_SCALE, MAX_CLIP_SCALE);
}

export type KenBurnsPreset = 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight' | 'panUp' | 'panDown';

export const KEN_BURNS_PRESETS: Record<KenBurnsPreset, KenBurns> = {
  zoomIn: { toScale: 1.12, toX: 0, toY: 0 },
  zoomOut: { toScale: 0.88, toX: 0, toY: 0 },
  panLeft: { toScale: 1.0, toX: -0.06, toY: 0 },
  panRight: { toScale: 1.0, toX: 0.06, toY: 0 },
  panUp: { toScale: 1.0, toX: 0, toY: -0.06 },
  panDown: { toScale: 1.0, toX: 0, toY: 0.06 },
};

export const KEN_BURNS_KEYS: readonly KenBurnsPreset[] = [
  'zoomIn',
  'zoomOut',
  'panLeft',
  'panRight',
  'panUp',
  'panDown',
];

export function getKenBurnsPreset(kb: KenBurns | undefined): KenBurnsPreset {
  if (!kb) return 'zoomIn';
  for (const key of KEN_BURNS_KEYS) {
    const val = KEN_BURNS_PRESETS[key];
    if (
      Math.abs(kb.toScale - val.toScale) < 0.01 &&
      Math.abs(kb.toX - val.toX) < 0.01 &&
      Math.abs(kb.toY - val.toY) < 0.01
    ) {
      return key;
    }
  }
  return 'zoomIn';
}

/**
 * Contexte geometrique permettant de borner le decalage au plus juste.
 *
 * Optionnel: sans lui, `clampTransform` retombe sur le plafond fixe. C'est ce
 * qui permet de le passer la ou la source est connue (geste de recadrage,
 * panneau Modifier) sans toucher aux appels qui n'en savent rien.
 */
export interface ClampContext {
  source: { width: number; height: number } | undefined;
  frame: { width: number; height: number };
  fit: 'cover' | 'contain';
}

/** Ramene un recadrage dans les bornes autorisees. */
export function clampTransform(
  transform: ClipTransform,
  context?: ClampContext,
): ClipTransform {
  const scale = clamp(transform.scale, MIN_CLIP_SCALE, MAX_CLIP_SCALE);

  /*
    La borne de decalage est calculee sur l'echelle DEJA bornee.

    Utiliser `transform.scale` brut laisserait un zoom aberrant (99) autoriser un
    deplacement enorme, alors que l'image sera dessinee a 5x seulement: le plan
    partirait hors du cadre.
  */
  const limit = context
    ? offsetLimitFor(context.source, context.frame, context.fit, scale)
    : { x: MAX_CLIP_OFFSET, y: MAX_CLIP_OFFSET };

  return {
    ...transform,
    scale,
    x: clamp(transform.x, -limit.x, limit.x),
    y: clamp(transform.y, -limit.y, limit.y),
    // La rotation est normalisee et non bornee: toutes les orientations sont
    // legitimes, contrairement a un zoom de 800 % ou a un decalage hors cadre.
    rotation: normalizeRotation(transform.rotation),
  };
}

/**
 * Cree un projet vierge.
 *
 * `defaults` porte ce que l'utilisateur a choisi une fois pour toutes (format,
 * fond). Sans ce parametre, « Nouveau reel » ramenait le projet en 9:16 sur fond
 * noir quels que soient les reglages — un utilisateur qui monte pour YouTube
 * devait rebasculer en 16:9 a chaque nouveau montage.
 *
 * Le parametre est OPTIONNEL et le domaine reste pur: il ne lit aucun store, il
 * recoit les valeurs de son appelant.
 */
export function createEmptyProject(
  name: string,
  defaults: {
    frame?: { width: number; height: number } | null;
    background?: ProjectBackground | null;
  } = {},
): Project {
  const now = Date.now();
  return {
    id: newId('proj'),
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name,
    createdAt: now,
    updatedAt: now,
    frame: {
      width: defaults.frame?.width ?? FRAME_WIDTH,
      height: defaults.frame?.height ?? FRAME_HEIGHT,
      // `fps` ne fait pas partie des preferences: il n'a rien a voir avec le
      // format et changer la cadence n'est pas un choix de mise en page.
      fps: FRAME_FPS,
    },
    background: defaults.background ?? { type: 'color', color: '#000000' },
    assets: {},
    videoTrack: { id: newId('vtrack'), kind: 'video', clips: [] },
    audioTracks: [],
    overlays: [],
    snapping: { enabled: true, division: 1 },
  };
}

/**
 * Cree un clip pour un media. Pour une video, l'extrait par defaut couvre
 * toute la source, plafonne a `maxVideoDuration` afin qu'un import de 3 minutes
 * ne remplisse pas la timeline d'un coup.
 */
export function createClipForAsset(
  asset: MediaAsset,
  options: { slideDuration?: Seconds; maxVideoDuration?: Seconds } = {},
): Clip {
  const slideDuration = options.slideDuration ?? DEFAULT_SLIDE_DURATION;
  const base: Clip = {
    id: newId('clip'),
    assetId: asset.id,
    start: 0,
    duration: slideDuration,
    fit: 'cover',
    transform: { scale: 1, x: 0, y: 0, rotation: 0 },
    muted: false,
  };

  if (asset.kind !== 'video') return base;

  const sourceDuration = asset.duration ?? slideDuration;
  const capped = options.maxVideoDuration
    ? Math.min(sourceDuration, options.maxVideoDuration)
    : sourceDuration;

  return {
    ...base,
    duration: capped,
    source: { in: 0, out: sourceDuration, speed: 1 },
  };
}

/**
 * Zone d'interet d'une image, en unites normalisees (0..1 de la source).
 *
 * Volontairement decouplee de la maniere dont on la calcule: le domaine reste
 * pur et ignore qu'un canvas a servi a la mesurer.
 */
export interface FocalPoint {
  x: NormUnit;
  y: NormUnit;
}

/**
 * Applique les preferences d'import a un plan.
 *
 * Fonction PURE, et c'est ce qui la rend testable: toute la geometrie du cadrage
 * automatique s'y trouve, sans canvas ni store. C'est aussi la partie la plus
 * susceptible d'etre fausse, donc celle qui merite le plus d'etre verrouillee
 * par des tests.
 *
 * L'ordre des operations n'est pas negociable:
 *   1. redresser (change l'orientation VUE de la source);
 *   2. cadrer (depend de l'orientation obtenue);
 *   3. zoomer (comble ce que le cadrage a laisse vide);
 *   4. recentrer (deplace ce que le zoom a rendu deplacable).
 * Recentrer avant de zoomer, par exemple, decalerait vers une zone que le zoom
 * ramenerait ensuite dans le cadre.
 */
export function applyImportPreferences(
  clip: Clip,
  source: { width: number; height: number } | undefined,
  frame: { width: number; height: number },
  preferences: ImportPreferences,
  focal?: FocalPoint,
): Clip {
  const next: Clip = { ...clip, fit: preferences.fit };
  if (!source || source.width <= 0 || source.height <= 0) return next;

  let sourceWidth = source.width;
  let sourceHeight = source.height;
  let rotation = clip.transform.rotation;

  /*
    1. Redressement.

    On ne tourne QUE si les orientations se contredisent (une photo paysage dans
    un cadre vertical, ou l'inverse). Une image carree n'est jamais tournee: elle
    ne contredit rien, et la tourner serait un mouvement gratuit.
  */
  if (preferences.autoRotate) {
    const sourceLandscape = sourceWidth > sourceHeight;
    const frameLandscape = frame.width > frame.height;
    const conflicting =
      sourceWidth !== sourceHeight &&
      frame.width !== frame.height &&
      sourceLandscape !== frameLandscape;

    if (conflicting) {
      rotation = normalizeRotation(rotation + QUARTER_TURN);
      // Apres un quart de tour, la source est VUE avec ses cotes echanges: tout
      // le calcul de cadrage qui suit doit raisonner sur ces dimensions-la.
      [sourceWidth, sourceHeight] = [sourceHeight, sourceWidth];
    }
  }

  let scale = clip.transform.scale;
  let x = clip.transform.x;
  let y = clip.transform.y;

  /*
    2 et 3. Zoom de remplissage.

    N'a de sens qu'en `contain`, seul mode qui laisse des bandes vides. En
    `cover` l'image deborde deja, et zoomer ne ferait que rogner davantage sans
    rien combler.
  */
  if (preferences.autoZoom && preferences.fit === 'contain') {
    const contain = Math.min(frame.width / sourceWidth, frame.height / sourceHeight);
    const cover = Math.max(frame.width / sourceWidth, frame.height / sourceHeight);
    if (contain > 0) scale = clamp(cover / contain, MIN_CLIP_SCALE, MAX_CLIP_SCALE);
  }

  /*
    4. Recentrage sur la zone d'interet.

    `focal` est exprime en fraction de la SOURCE; le decalage attendu par le
    compositeur est en fraction de la FRAME. On convertit en mesurant de combien
    l'image deborde: sans debordement sur un axe, aucun deplacement n'est
    possible, et forcer un decalage ferait entrer du vide dans le cadre.

    Consequence mesuree, et qui surprend: le recentrage n'a souvent d'effet que
    sur UN seul axe. Une photo 2:3 (3456x5184) posee en `cover` dans un cadre
    9:16 est dessinee en 1280x1920 — elle deborde de 200 px en largeur et de
    ZERO en hauteur. Un visage situe en haut ne peut donc pas etre remonte: il
    n'y a aucune marge verticale a exploiter. Ce n'est pas un defaut du calcul,
    c'est la geometrie; le sujet est deja entierement visible en hauteur.
  */
  if (preferences.autoCenter && focal) {
    const drawn = fittedSize(sourceWidth, sourceHeight, frame, next.fit, scale);
    const overflowX = Math.max(0, drawn.width - frame.width);
    const overflowY = Math.max(0, drawn.height - frame.height);

    // 0,5 - focal: un point d'interet a gauche (0,2) demande a DEPLACER l'image
    // vers la droite pour l'amener au centre.
    x = clamp(((0.5 - focal.x) * overflowX) / frame.width, -MAX_CLIP_OFFSET, MAX_CLIP_OFFSET);
    y = clamp(
      ((0.5 - focal.y) * overflowY) / frame.height,
      -MAX_CLIP_OFFSET,
      MAX_CLIP_OFFSET,
    );
  }

  return { ...next, transform: clampTransform({ scale, x, y, rotation }) };
}

/** Taille a laquelle une source est dessinee dans la frame, zoom compris. */
function fittedSize(
  sourceWidth: number,
  sourceHeight: number,
  frame: { width: number; height: number },
  fit: 'cover' | 'contain',
  scale: number,
): { width: number; height: number } {
  const ratio = sourceWidth / sourceHeight;
  const frameRatio = frame.width / frame.height;
  const fillWidth = fit === 'cover' ? ratio < frameRatio : ratio > frameRatio;
  const width = fillWidth ? frame.width : frame.height * ratio;
  const height = fillWidth ? frame.width / ratio : frame.height;
  return { width: width * scale, height: height * scale };
}

export function addAsset(project: Project, asset: MediaAsset): Project {
  return {
    ...project,
    assets: { ...project.assets, [asset.id]: asset },
    updatedAt: Date.now(),
  };
}

/** Ajoute un media a la fin du montage (et a la bibliotheque si absent). */
export function appendAssetToTimeline(
  project: Project,
  asset: MediaAsset,
  options?: {
    slideDuration?: Seconds;
    maxVideoDuration?: Seconds;
    /**
     * Rang d'insertion. Omis, le plan est ajoute a la FIN.
     *
     * L'appelant le derive de la tete de lecture: le domaine reste pur et ne
     * connait pas la position de lecture.
     */
    index?: number;
  },
): Project {
  const withAsset = project.assets[asset.id] ? project : addAsset(project, asset);
  const clip = createClipForAsset(asset, options);
  const track = withAsset.videoTrack;
  return {
    ...withAsset,
    videoTrack:
      options?.index === undefined
        ? appendClip(track, clip, project.frame.fps)
        : insertClip(track, clip, options.index, project.frame.fps),
    updatedAt: Date.now(),
  };
}

/** Un media est orphelin s'il n'est reference ni par un clip ni par une piste audio. */
export function isAssetUsed(project: Project, assetId: string): boolean {
  return (
    project.videoTrack.clips.some((clip) => clip.assetId === assetId) ||
    project.audioTracks.some((track) => track.assetId === assetId)
  );
}

export function orphanAssetIds(project: Project): string[] {
  return Object.keys(project.assets).filter((id) => !isAssetUsed(project, id));
}

// ---------------------------------------------------------------------------
// Styles de texte
// ---------------------------------------------------------------------------

export function textStyleForPreset(preset: TextPreset): TextStyle {
  const base: TextStyle = {
    font: 'sans',
    fontFamily: FONT_STACKS.sans,
    fontSize: 0.075,
    fontWeight: 700,
    color: '#ffffff',
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    preset,
  };

  switch (preset) {
    case 'plain':
      return base;
    case 'caption':
      // Contour noir: lisible sur n'importe quelle image, sans fond opaque.
      return { ...base, fontSize: 0.06, stroke: { color: '#000000', width: 0.16 } };
    case 'karaoke':
      return {
        ...base,
        font: 'condensed',
        fontFamily: FONT_STACKS.condensed,
        fontSize: 0.085,
        fontWeight: 800,
        letterSpacing: -0.02,
        stroke: { color: '#000000', width: 0.12 },
        shadow: { color: 'rgba(0,0,0,0.5)', blur: 0.03, x: 0, y: 0.006 },
      };
    case 'sticker':
      return {
        ...base,
        color: '#09090b',
        background: { color: '#ffffff', padding: 0.028, radius: 0.02 },
      };
    case 'neon':
      return {
        ...base,
        color: '#ffffff',
        shadow: { color: '#8b5cf6', blur: 0.05, x: 0, y: 0 },
        stroke: { color: '#a78bfa', width: 0.06 },
      };
  }
}

export function createTextOverlay(
  text: string,
  options: { start?: Seconds; duration?: Seconds; preset?: TextPreset } = {},
): TextOverlay {
  return {
    id: newId('text'),
    text,
    start: options.start ?? 0,
    duration: options.duration ?? DEFAULT_TEXT_DURATION,
    // Legerement au-dessus du centre: la zone basse est occupee par l'UI d'Instagram.
    x: 0.5,
    y: 0.42,
    maxWidth: 0.8,
    rotation: 0,
    style: textStyleForPreset(options.preset ?? 'caption'),
    animation: { in: 'popIn', out: 'fade', duration: 0.35 },
  };
}

/**
 * Cree un masque texte, pret a poser.
 *
 * Taille de depart tres grande (60 % de la largeur): un masque tient son effet
 * de sa DEMESURE — a la taille d'un titre ordinaire, la decoupe ne laisse voir
 * qu'un filet d'image et l'effet ne se lit pas. On part donc du cas utile.
 */
export function createTextMask(
  text: string,
  options: { start?: Seconds; duration?: Seconds } = {},
): TextMask {
  return {
    id: newId('mask'),
    text,
    start: options.start ?? 0,
    duration: options.duration ?? DEFAULT_TEXT_DURATION,
    x: 0.5,
    y: 0.5,
    rotation: 0,
    font: 'condensed',
    fontFamily: FONT_STACKS.condensed,
    fontSize: 0.6,
    // Le plus gras disponible: une graisse fine ne laisse pas assez de surface
    // pour qu'on reconnaisse l'image a travers la lettre.
    fontWeight: 900,
    letterSpacing: 0,
    fillColor: '#000000',
    fillOpacity: 1,
  };
}

/**
 * Applique un choix de police.
 *
 * Passe par cette fonction plutot que par un `Object.assign`: `font` et
 * `fontFamily` doivent rester coherents, et les separer ferait afficher une
 * police differente de celle que montre l'interface.
 */
export function withFont(style: TextStyle, font: FontChoice): TextStyle {
  return { ...style, font, fontFamily: FONT_STACKS[font] };
}

// ---------------------------------------------------------------------------
// Filtres
// ---------------------------------------------------------------------------

/** Filtre neutre: l'identite. Sert aussi de base a l'interpolation d'intensite. */
export function neutralFilter(): ClipFilter {
  return {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    hueRotate: 0,
    sepia: 0,
    blur: 0,
    intensity: 1,
    preset: 'none',
  };
}

/**
 * Looks proposes.
 *
 * Chacun reste discret: un filtre agressif sur une video deja etalonnee donne
 * un resultat sale, et l'utilisateur dose ensuite avec `intensity`.
 */
export function filterForPreset(preset: FilterPreset): ClipFilter {
  const base = neutralFilter();

  switch (preset) {
    case 'none':
    case 'custom':
      return { ...base, preset };
    case 'vivid':
      return { ...base, preset, contrast: 1.15, saturation: 1.35 };
    case 'faded':
      // Contraste abaisse et legere desaturation: le rendu "pellicule lavee".
      return { ...base, preset, brightness: 1.08, contrast: 0.85, saturation: 0.8 };
    case 'mono':
      return { ...base, preset, saturation: 0, contrast: 1.1 };
    case 'warm':
      return { ...base, preset, sepia: 0.3, saturation: 1.1, hueRotate: -8 };
    case 'cool':
      return { ...base, preset, hueRotate: 12, saturation: 1.05, brightness: 1.02 };
    case 'noir':
      return { ...base, preset, saturation: 0, contrast: 1.45, brightness: 0.95 };
    case 'vhs':
      // Le flou tres faible imite la perte de definition d'une bande magnetique.
      return { ...base, preset, saturation: 1.25, contrast: 0.9, hueRotate: -12, blur: 0.0015 };
  }
}

/** Vrai si le filtre ne modifie rien: inutile de le conserver sur le clip. */
export function isNeutralFilter(filter: ClipFilter): boolean {
  return (
    filter.intensity === 0 ||
    filter.preset === 'none' ||
    (filter.brightness === 1 &&
      filter.contrast === 1 &&
      filter.saturation === 1 &&
      filter.hueRotate === 0 &&
      filter.sepia === 0 &&
      filter.blur === 0)
  );
}

// ---------------------------------------------------------------------------
// Paroles
// ---------------------------------------------------------------------------

export function createLyrics(): Lyrics {
  return {
    lines: [],
    style: textStyleForPreset('karaoke'),
    x: 0.5,
    // Plus bas que le texte libre: les paroles se lisent comme un sous-titre.
    y: 0.72,
    maxWidth: 0.84,
    animation: { in: 'fade', out: 'fade', duration: 0.2 },
    beatsPerLine: 4,
    // Surlignage actif par defaut: c'est ce qu'on attend de paroles synchronisees.
    // Sans mots horodates il se rabat sur un balayage regulier, ce qui reste
    // preferable a un texte inerte.
    karaoke: { enabled: true, color: KARAOKE_SUNG_COLOR },
  };
}

/**
 * Couleur de la partie deja chantee.
 *
 * Le chartreuse du rythme: les paroles sont calees sur les temps, et c'est la
 * seule famille de couleur qui designe le rythme dans toute l'application.
 */
export const KARAOKE_SUNG_COLOR = '#e8ff3a';

/**
 * Complete un objet `Lyrics` dont des champs recents manqueraient.
 *
 * Indispensable et pas seulement defensif: `setLyricsLines` et
 * `setLyricsFromText` font `project.lyrics ?? createLyrics()`, si bien qu'un
 * projet possedant DEJA des paroles n'obtient jamais les valeurs par defaut des
 * champs ajoutes depuis. Le surlignage karaoke restait ainsi absent pour tout
 * utilisateur ayant des paroles anterieures — constate en mesurant les clefs
 * reellement persistees, qui s'arretaient a `beatsPerLine`.
 *
 * Passe par ici plutot que par une migration de schema: la migration ne joue
 * qu'au chargement, alors que ce completement doit valoir a chaque ecriture.
 */
export function completeLyrics(lyrics: Lyrics): Lyrics {
  return {
    ...lyrics,
    karaoke: lyrics.karaoke ?? { enabled: true, color: KARAOKE_SUNG_COLOR },
  };
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export function createAudioTrack(
  asset: MediaAsset,
  role: AudioRole = 'music',
  options: { start?: Seconds } = {},
): Project['audioTracks'][number] {
  const duration = asset.duration ?? 0;
  /**
   * Le son d'origine d'une video suit son image.
   *
   * Il commence donc la ou le plan est pose, pas a zero, et n'a pas de fondu de
   * sortie: un fondu ferait s'eteindre une voix ou un bruit d'ambiance avant la
   * fin du plan, ce qui s'entend comme un defaut. Le fondu de fin de reel reste
   * l'affaire de la piste musicale.
   */
  const isOriginal = role === 'original';

  return {
    id: newId('atrack'),
    kind: 'audio',
    assetId: asset.id,
    role,
    start: options.start ?? 0,
    source: { in: 0, out: duration },
    // Le son d'origine passe SOUS la musique par defaut: on le veut presque
    // toujours en complement, pas au premier plan.
    gain: isOriginal ? DEFAULT_ORIGINAL_GAIN : 1,
    muted: false,
    fadeIn: 0,
    // Un court fondu de sortie evite la coupure nette en fin de reel.
    fadeOut: isOriginal ? 0 : Math.min(0.4, duration / 4),
  };
}

/**
 * Volume par defaut du son d'origine d'une video.
 *
 * Sous 1 volontairement: le son d'origine accompagne le plus souvent une
 * musique, et l'introduire a plein volume couvrirait celle-ci. L'utilisateur le
 * remonte s'il veut l'inverse.
 */
export const DEFAULT_ORIGINAL_GAIN = 0.7;

/** La piste musicale principale, celle sur laquelle porte l'analyse rythmique. */
export function musicTrack(project: Project): Project['audioTracks'][number] | undefined {
  return project.audioTracks.find((track) => track.role === 'music');
}

// ---------------------------------------------------------------------------
// Reglages
// ---------------------------------------------------------------------------

export function setSnapping(
  project: Project,
  patch: Partial<{ enabled: boolean; division: BeatDivision }>,
): Project {
  return {
    ...project,
    snapping: { ...project.snapping, ...patch },
    updatedAt: Date.now(),
  };
}

export function touch(project: Project): Project {
  return { ...project, updatedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Amene un projet persiste au schema courant.
 *
 * Les etapes sont en cascade et chacune ne connait que son propre saut de
 * version: un projet v1 traverse toutes les etapes jusqu'au schema courant.
 */
export function migrateProject(raw: Project): Project {
  let project = raw;

  if (project.schemaVersion > PROJECT_SCHEMA_VERSION) {
    // Projet ecrit par une version plus recente de l'app: on ne sait pas le lire.
    throw new Error(
      `Schema de projet ${project.schemaVersion} plus recent que ${PROJECT_SCHEMA_VERSION}`,
    );
  }

  if (project.schemaVersion < 2) project = migrateV1toV2(project);

  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    project = { ...project, schemaVersion: PROJECT_SCHEMA_VERSION };
  }

  return project;
}

/**
 * v1 -> v2: ajoute `TextStyle.font` et complete `ClipFilter`.
 *
 * Sans cette etape, un projet enregistre avant la v2 rendrait un texte avec
 * `font: undefined` (police par defaut du canvas, differente de celle affichee
 * par l'interface) et un filtre dont `intensity` vaudrait `undefined` — donc un
 * `NaN` propage dans la chaine CSS du compositeur, qui effacerait l'image.
 */
function migrateV1toV2(project: Project): Project {
  /** Retrouve le choix de police a partir de la pile CSS enregistree. */
  const fontFor = (style: TextStyle): FontChoice => {
    if (style.font) return style.font;
    const stack = (style.fontFamily ?? '').toLowerCase();
    if (stack.includes('georgia') || stack.includes('times')) return 'serif';
    if (stack.includes('mono') || stack.includes('menlo')) return 'mono';
    if (stack.includes('narrow') || stack.includes('impact')) return 'condensed';
    if (stack.includes('rounded')) return 'rounded';
    return 'sans';
  };

  const upgradeStyle = (style: TextStyle): TextStyle => withFont(style, fontFor(style));

  const upgradeFilter = (filter: Clip['filter']): Clip['filter'] => {
    if (!filter) return undefined;
    const neutral = neutralFilter();
    return {
      ...neutral,
      // Les trois champs de la v1 sont conserves; les autres prennent
      // l'identite, et le look devient `custom` puisqu'il ne correspond a
      // aucun preset nomme.
      brightness: filter.brightness ?? neutral.brightness,
      contrast: filter.contrast ?? neutral.contrast,
      saturation: filter.saturation ?? neutral.saturation,
      preset: 'custom',
    };
  };

  return {
    ...project,
    videoTrack: {
      ...project.videoTrack,
      clips: project.videoTrack.clips.map((clip) => ({
        ...clip,
        filter: upgradeFilter(clip.filter),
      })),
    },
    overlays: project.overlays.map((overlay) => ({
      ...overlay,
      style: upgradeStyle(overlay.style),
    })),
    lyrics: project.lyrics
      ? { ...project.lyrics, style: upgradeStyle(project.lyrics.style) }
      : undefined,
    schemaVersion: 2,
  };
}

/** Nettoie une piste video vide de tout clip pointant sur un media disparu. */
export function pruneDanglingClips(project: Project): Project {
  const clips = project.videoTrack.clips.filter((clip) => project.assets[clip.assetId]);
  const audioTracks = project.audioTracks.filter((track) => project.assets[track.assetId]);
  if (
    clips.length === project.videoTrack.clips.length &&
    audioTracks.length === project.audioTracks.length
  ) {
    return project;
  }
  // Le filtrage laisse des trous: il faut re-rippler pour restaurer l'invariant.
  return {
    ...project,
    videoTrack: { ...project.videoTrack, clips: ripple(clips, project.frame.fps) },
    audioTracks,
  };
}
