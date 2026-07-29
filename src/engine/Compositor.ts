/**
 * LE compositeur. C'est la SEULE fonction de l'application qui dessine des
 * pixels, et elle est une fonction pure de `(Scene) -> pixels`.
 *
 * Elle ne connait ni le temps, ni la lecture, ni l'export: elle recoit une
 * `Scene` deja resolue et la dessine. C'est cette contrainte qui garantit que
 * l'apercu et le MP4 exporte sont identiques — il n'existe pas deux chemins de
 * dessin qui pourraient divergerie.
 *
 * Le contexte peut etre un canvas visible ou un `OffscreenCanvas` (export dans
 * un worker): l'API 2D utilisee est volontairement l'intersection des deux.
 */

import type { ClipLayer, ProjectBackground, Scene } from '../domain/types';
import { drawTextLayer, drawTextMaskLayer, type Ctx2D } from './TextRenderer';
import { filterToCss } from './filters';

// Re-export: `filterToCss` vivait ici avant d'etre extrait dans `filters.ts`
// pour que `TextRenderer` puisse l'utiliser sans cycle d'import. Les appelants
// existants n'ont pas a savoir qu'il a demenage.
export { filterToCss } from './filters';
import {
  neutralTransition,
  transitionStateFor,
  type TransitionMask,
  type TransitionOverlay,
} from './transitions';
import { clamp01, lerp } from '../lib/math';

/**
 * Voile noir pose sur le fond flou.
 *
 * Sans lui, un fond issu d'une photo claire concurrence le sujet net: les deux
 * ont la meme luminosite, et l'oeil ne sait plus ou se poser. 0,25 suffit a
 * etablir la hierarchie sans donner l'impression d'une image sous-exposee.
 */
const BLUR_BACKGROUND_SHADE = 0.25;

export interface DrawTarget {
  ctx: Ctx2D;
  /** Dimensions du canvas en pixels. Peut differer de `scene.frame`. */
  width: number;
  height: number;
}

/**
 * Dessine une scene.
 *
 * Le canvas cible peut avoir n'importe quelle taille: on met a l'echelle
 * l'ensemble du rendu pour que la scene (definie en unites normalisees et en
 * pixels de frame) remplisse exactement la cible. Un apercu de 236x420 et un
 * export de 1080x1920 passent donc par le meme code, a un facteur pres.
 */
export function draw(scene: Scene, target: DrawTarget): void {
  const { ctx, width, height } = target;

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // Mise a l'echelle: tout le dessin en aval raisonne en pixels de frame.
  const scaleX = width / scene.frame.width;
  const scaleY = height / scene.frame.height;
  ctx.scale(scaleX, scaleY);

  const frameWidth = scene.frame.width;
  const frameHeight = scene.frame.height;

  drawBackground(ctx, scene, frameWidth, frameHeight);

  // Les couches sont deja dans l'ordre de dessin (fond -> premier plan).
  for (const layer of scene.layers) {
    if (layer.type === 'clip') {
      drawClipLayer(ctx, layer, frameWidth, frameHeight, scene.background);
    } else if (layer.type === 'textMask') {
      drawTextMaskLayer(ctx, layer, frameWidth, frameHeight);
    } else {
      drawTextLayer(ctx, layer, frameWidth, frameHeight);
    }
  }

  ctx.restore();
}

function drawBackground(
  ctx: Ctx2D,
  scene: Scene,
  frameWidth: number,
  frameHeight: number,
): void {
  // `blur` est un fond DERIVE du clip: il ne peut pas etre peint ici, faute
  // d'acces a l'image. `drawClipLayer` s'en charge, sous le plan. Le noir pose
  // ici reste utile: il couvre le cas ou aucun clip n'est visible.
  const color = scene.background.type === 'color' ? scene.background.color : '#000000';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, frameWidth, frameHeight);
}

/**
 * Geometrie du cadrage: ou dessiner une source de dimensions donnees dans la
 * frame, selon `cover` (remplir, quitte a rogner) ou `contain` (tout montrer).
 */
export function fitRect(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
  fit: 'cover' | 'contain',
): { x: number; y: number; width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: frameWidth, height: frameHeight };
  }

  const sourceRatio = sourceWidth / sourceHeight;
  const frameRatio = frameWidth / frameHeight;
  const fillWidth = fit === 'cover' ? sourceRatio < frameRatio : sourceRatio > frameRatio;

  const width = fillWidth ? frameWidth : frameHeight * sourceRatio;
  const height = fillWidth ? frameWidth / sourceRatio : frameHeight;

  return {
    x: (frameWidth - width) / 2,
    y: (frameHeight - height) / 2,
    width,
    height,
  };
}

/** Arrondi a 4 decimales: evite les chaines a rallonge dues aux flottants. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Restreint le dessin a la zone visible d'un masque de transition.
 *
 * La traduction « fraction ouverte -> geometrie » vit ICI et non dans
 * `transitions.ts`, qui doit rester pur: seul le compositeur connait les
 * dimensions reelles de la frame. Le module de transitions se contente de dire
 * *combien* est ouvert, jamais *ou* en pixels.
 *
 * `amount` vaut 0 quand c'est ferme et 1 quand c'est entierement ouvert.
 */
function clipToMask(
  ctx: Ctx2D,
  mask: TransitionMask,
  frameWidth: number,
  frameHeight: number,
): void {
  const amount = clamp01(mask.amount);
  ctx.beginPath();

  switch (mask.kind) {
    case 'bars': {
      /*
        Obturateur: deux volets partant du HAUT et du BAS vers le centre.

        La zone visible est la bande centrale. A `amount` = 0 elle est nulle,
        d'ou un ecran entierement noir au point de bascule — c'est exactement ce
        qu'on attend d'un obturateur ferme.
      */
      const visible = frameHeight * amount;
      const top = (frameHeight - visible) / 2;
      ctx.rect(0, top, frameWidth, visible);
      break;
    }

    case 'circle': {
      /*
        Iris: disque centre.

        Le rayon vise le COIN et non le bord, sinon les angles resteraient noirs
        a pleine ouverture — l'hypotenuse est la seule distance qui garantit de
        couvrir toute la frame.
      */
      const maxRadius = Math.hypot(frameWidth, frameHeight) / 2;
      ctx.arc(frameWidth / 2, frameHeight / 2, maxRadius * amount, 0, Math.PI * 2);
      break;
    }

    case 'wipeX':
      // Balayage: la zone decouverte s'etend depuis le bord gauche.
      ctx.rect(0, 0, frameWidth * amount, frameHeight);
      break;
  }

  ctx.clip();
}

/**
 * Peint le voile d'une transition PAR-DESSUS le clip.
 *
 * Comme `clipToMask`, la traduction « fraction -> pixels » vit ici: le module de
 * transitions dit *ou en est* le voile, jamais *ou* il tombe en pixels.
 *
 * Le voile est peint hors de toute transformation du clip. Le poser a
 * l'interieur le ferait deriver, tourner et zoomer avec le plan: son bord
 * cesserait d'etre vertical des qu'un clip porte une rotation, et un plan
 * agrandi le pousserait hors du cadre.
 */
function drawTransitionOverlay(
  ctx: Ctx2D,
  overlay: TransitionOverlay,
  frameWidth: number,
  frameHeight: number,
  clipOpacity: number,
): void {
  const swept = clamp01(overlay.progress);

  /*
    Un seul rectangle couvert, decrit dans le sens du mouvement puis retourne
    dans le repere de la frame.

    `along` est l'axe parcouru par le voile, `span` sa dimension perpendiculaire.
    Le bord tombe a `swept` de la course quel que soit le sens: pour `left` et
    `up` le voile s'echappe vers l'origine de l'axe, donc la zone couverte est ce
    qui RESTE devant lui; pour `right` et `down` elle est derriere.
  */
  const vertical = overlay.direction === 'up' || overlay.direction === 'down';
  const along = vertical ? frameHeight : frameWidth;
  const span = vertical ? frameWidth : frameHeight;
  const towardsOrigin = overlay.direction === 'left' || overlay.direction === 'up';

  /*
    Le bord avance depuis l'origine ou recule depuis la fin, selon le sens. La
    zone couverte a la meme taille dans les deux cas — c'est ce qui RESTE a
    parcourir — mais elle se pose de l'autre cote du bord.
  */
  const edgePosition = towardsOrigin ? swept * along : along - swept * along;
  const coveredSize = along - swept * along;
  const coveredStart = towardsOrigin ? edgePosition : 0;

  /** Pose un rectangle exprime le long de l'axe du mouvement. */
  const fillAlong = (start: number, size: number): void => {
    if (vertical) ctx.fillRect(0, start, span, size);
    else ctx.fillRect(start, 0, size, span);
  };

  ctx.save();
  ctx.fillStyle = '#ffffff';

  /*
    Le voile ne peut pas etre plus present que le plan qu'il recouvre: il est
    module par l'opacite du clip. Sans cela, un clip a demi transparent
    montrerait un voile a pleine force flottant devant le fond.
  */
  if (coveredSize > 0) {
    ctx.globalAlpha = clamp01(overlay.opacity) * clipOpacity;
    fillAlong(coveredStart, coveredSize);
  }

  /*
    Le trait est dessine meme quand le voile est entierement sorti: c'est lui qui
    prolonge le geste sur la derniere frame. Il est centre sur le bord et non
    pose a cote, pour que le voile et son trait partagent exactement la meme
    position — un trait pose a cote se decalerait d'une demi-epaisseur selon le
    sens, et la paire gauche/droite cesserait d'etre symetrique.
  */
  const lineWidth = overlay.lineWidth * frameWidth;
  if (lineWidth > 0 && overlay.lineOpacity > 0) {
    ctx.globalAlpha = clamp01(overlay.lineOpacity) * clipOpacity;
    fillAlong(edgePosition - lineWidth / 2, lineWidth);
  }

  ctx.restore();
}

function drawClipLayer(
  ctx: Ctx2D,
  layer: ClipLayer,
  frameWidth: number,
  frameHeight: number,
  background: ProjectBackground,
): void {
  const { clip, frame, sourceWidth, sourceHeight } = layer;
  if (!frame) return;

  /*
    Le role et l'accent sont portes par la scene: le compositeur ne les devine
    jamais. `transitionStateFor` compose l'accent eventuel, si bien qu'on ne
    trouve ici aucune trace de la facon dont les canaux se combinent.
  */
  const transition = layer.transition
    ? transitionStateFor(
        layer.transition.type,
        layer.transition.progress,
        layer.transition.role,
        layer.transition.accent,
      )
    : neutralTransition();

  const opacity = clamp01(layer.opacity * transition.opacity);
  if (opacity <= 0.001) return;

  ctx.save();
  ctx.globalAlpha = opacity;

  /*
    Filtre du clip et flou de transition se CUMULENT dans la meme chaine CSS.

    Les affecter l'un apres l'autre a `ctx.filter` ne les composerait pas: la
    seconde ecriture remplace la premiere, et le filtre du plan disparaitrait
    pendant toute la transition.
  */
  const filters: string[] = [];
  if (clip.filter) {
    // `filter` n'existe pas partout sur OffscreenCanvas: on ne l'applique
    // qu'en presence de valeurs non neutres, et on tolere son absence.
    const css = filterToCss(clip.filter, frameWidth);
    if (css) filters.push(css);
  }
  // Rayon en pixels de FRAME, comme tous les flous du projet.
  if (transition.blur > 0) filters.push(`blur(${round(transition.blur * frameWidth)}px)`);
  if (filters.length > 0) ctx.filter = filters.join(' ');

  // Ken Burns: on interpole l'echelle et la position sur la duree du clip.
  const kb = clip.kenBurns;
  const t = clamp01(layer.clipProgress);
  const scale =
    (kb ? lerp(clip.transform.scale, kb.toScale, t) : clip.transform.scale) * transition.scale;
  const offsetX = (kb ? lerp(clip.transform.x, kb.toX, t) : clip.transform.x) + transition.translateX;
  const offsetY = (kb ? lerp(clip.transform.y, kb.toY, t) : clip.transform.y) + transition.translateY;

  /*
    Le masque se pose AVANT les transformations du clip.

    Il decoupe la frame — un obturateur appartient a la camera, pas a l'image:
    le poser apres le rotate/scale le ferait trembler et pivoter avec le plan,
    et les volets cesseraient d'etre horizontaux.
  */
  if (transition.mask) clipToMask(ctx, transition.mask, frameWidth, frameHeight);

  // Toutes les transformations tournent autour du centre de la frame.
  ctx.translate(frameWidth / 2 + offsetX * frameWidth, frameHeight / 2 + offsetY * frameHeight);
  const rotation = clip.transform.rotation + transition.rotate;
  if (rotation !== 0) ctx.rotate(rotation);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.translate(-frameWidth / 2, -frameHeight / 2);

  const rect = fitRect(sourceWidth, sourceHeight, frameWidth, frameHeight, clip.fit);

  /*
    Fond flou: uniquement en `contain`, seul mode qui laisse des bandes a remplir.
    En `cover` l'image deborde deja, donc flouter serait du travail perdu a chaque
    frame.

    L'ordre compte: le flou passe SOUS le plan, donc avant lui. Il est dessine en
    `cover` (il remplit) puis assombri, pour que le sujet net garde la primaute
    visuelle — sans ce voile, un fond trop present concurrence le premier plan.
  */
  if (background.type === 'blur' && clip.fit === 'contain') {
    const cover = fitRect(sourceWidth, sourceHeight, frameWidth, frameHeight, 'cover');
    ctx.save();
    // Rayon en pixels de FRAME: comme les autres flous, il se multiplie par la
    // largeur pour qu'un apercu 390 px et un export 1080 px se ressemblent.
    ctx.filter = `blur(${round(background.amount * frameWidth)}px)`;
    ctx.drawImage(frame, cover.x, cover.y, cover.width, cover.height);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = BLUR_BACKGROUND_SHADE * opacity;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, frameWidth, frameHeight);
    ctx.restore();
  }

  ctx.drawImage(frame, rect.x, rect.y, rect.width, rect.height);

  ctx.restore();

  // Le calque glissant se dessine par-dessus le plan, hors de toute
  // transformation — voir la note de `drawTransitionOverlay`.
  if (transition.overlay) {
    drawTransitionOverlay(ctx, transition.overlay, frameWidth, frameHeight, opacity);
  }

  // Le voile du flash se dessine par-dessus, hors de toute transformation.
  if (transition.flash > 0) {
    ctx.save();
    ctx.globalAlpha = transition.flash;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, frameWidth, frameHeight);
    ctx.restore();
  }
}
