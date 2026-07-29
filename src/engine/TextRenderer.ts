/**
 * Rendu de texte sur canvas.
 *
 * Toutes les mesures sont derivees de `frameWidth`, jamais de pixels absolus:
 * c'est ce qui garantit qu'un apercu de 390 px et un export de 1080 px donnent
 * exactement la meme mise en page (retour a la ligne au meme mot, meme
 * position). C'est la defense structurelle contre la divergence apercu/export.
 *
 * On dessine avec `fillText` et jamais via un `foreignObject` SVG: le texte
 * vient de l'utilisateur, et le passer dans un moteur HTML ouvrirait une voie
 * d'injection.
 */

import type { TextAnim, TextLayer, TextMaskLayer, TextStyle } from '../domain/types';
import { clamp01, easeOutBack, easeOutCubic, lerp } from '../lib/math';
import { filterToCss } from './filters';

/** Contexte de dessin, commun a `CanvasRenderingContext2D` et OffscreenCanvas. */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface ResolvedAnim {
  opacity: number;
  translateY: number;
  scale: number;
  /** Fraction du texte a afficher, dans [0, 1] — pour `typewriter`. */
  reveal: number;
}

/**
 * Plancher des animations d'ENTREE, a leur tout premier instant.
 *
 * Un texte ajoute a la position de lecture est rendu a `t = 0`. Sans plancher,
 * son opacite y vaut exactement zero, `drawTextLayer` s'arrete avant de dessiner
 * et l'utilisateur ne voit rien apparaitre.
 *
 * La valeur a ete MESUREE, pas choisie: a 0,06 le plancher existait bel et bien
 * mais restait invisible (blanc a 6 % sur noir donne une luminance d'environ 15,
 * et les bords antialiases des glyphes sont plus sombres encore), donc le bug
 * subsistait a l'ecran. A 0,3, le texte est franchement perceptible des sa
 * premiere frame tout en laissant les 70 % restants au fondu.
 *
 * Ne s'appliquent jamais a la SORTIE: un texte qui sort doit finir a zero.
 */
const MIN_ENTER_OPACITY = 0.3;
const MIN_ENTER_REVEAL = 0.05;

/**
 * Echelle minimale d'une entree.
 *
 * `popIn` part de `easeOutBack(0)`, qui vaut exactement 0: le texte est alors
 * dessine a une echelle nulle, donc sans aucune surface. L'opacite seule ne
 * suffisait pas a le rendre visible — c'est un second chemin vers l'invisibilite
 * au tout premier instant, et il demande son propre plancher.
 */
const MIN_ENTER_SCALE = 0.35;

function animState(anim: TextAnim, t: number, entering: boolean): ResolvedAnim {
  const base: ResolvedAnim = { opacity: 1, translateY: 0, scale: 1, reveal: 1 };
  // `t` = 0 au debut de l'animation, 1 quand elle est finie.
  const p = clamp01(t);

  /**
   * Opacite d'entree, jamais tout a fait nulle.
   *
   * Un texte pose exactement sous la tete de lecture est rendu a `t = 0`: sans
   * ce plancher son opacite vaut zero, `drawTextLayer` l'ecarte, et
   * l'utilisateur ne voit rien apparaitre. Le plancher ne s'applique qu'a
   * l'ENTREE — une sortie doit bel et bien finir a zero.
   */
  const fadeIn = (value: number) =>
    entering ? Math.max(MIN_ENTER_OPACITY, value) : value;

  switch (anim) {
    case 'none':
      return base;
    case 'fade':
      return { ...base, opacity: fadeIn(p) };
    case 'popIn':
      return entering
        ? {
            ...base,
            opacity: fadeIn(Math.min(1, p * 2)),
            // `easeOutBack(0)` vaut 0: sans plancher, le texte serait dessine a
            // une echelle nulle et n'occuperait aucun pixel.
            scale: Math.max(MIN_ENTER_SCALE, easeOutBack(p)),
          }
        : { ...base, opacity: p, scale: lerp(0.9, 1, p) };
    case 'slideUp':
      return { ...base, opacity: fadeIn(p), translateY: (1 - easeOutCubic(p)) * 0.06 };
    case 'typewriter':
      // La machine a ecrire revele au moins un caractere des le premier instant:
      // un texte totalement vide se lirait comme une panne.
      return entering
        ? { ...base, reveal: Math.max(MIN_ENTER_REVEAL, p) }
        : { ...base, opacity: p };
  }
}

/** Decoupe le texte en lignes tenant dans `maxWidth`, en respectant les \n. */
export function wrapText(ctx: Ctx2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }

    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || current === '') {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}

/** Construit la chaine `font` du canvas a partir du style et de la frame. */
function fontString(style: TextStyle, frameWidth: number): string {
  const sizePx = style.fontSize * frameWidth;
  return `${style.fontWeight} ${sizePx}px ${style.fontFamily}`;
}

/** Tronque `text` a une fraction de sa longueur (effet machine a ecrire). */
function revealText(text: string, reveal: number): string {
  if (reveal >= 1) return text;
  // On compte en points de code pour ne pas couper un emoji en deux.
  const chars = Array.from(text);
  return chars.slice(0, Math.ceil(chars.length * clamp01(reveal))).join('');
}

/**
 * Nombre de passes de lueur.
 *
 * Trois: une seule passe donne un halo pale et net, qui se lit comme une ombre
 * mal reglee. Chaque passe redessine le texte avec un rayon plus court, si bien
 * que la densite augmente vers les lettres — c'est ce degrade qui fait lire
 * l'effet comme une emission de lumiere.
 */
const GLOW_PASSES = 3;

/**
 * Peint la lueur d'un texte, sous le remplissage.
 *
 * L'ombre du canvas est detournee: on dessine le texte lui-meme en transparent
 * (`globalAlpha` porte par l'intensite) et c'est son ombre, centree et sans
 * decalage, qui fait le halo. Un `filter: blur()` sur le contexte flouterait
 * aussi tout ce qui suit dans la meme passe.
 */
function drawGlow(
  ctx: Ctx2D,
  lines: readonly string[],
  options: {
    anchorX: number;
    firstLineY: number;
    lineHeight: number;
    glow: NonNullable<TextStyle['glow']>;
    frameWidth: number;
  },
): void {
  const { anchorX, firstLineY, lineHeight, glow, frameWidth } = options;
  const radius = glow.radius * frameWidth;
  if (radius <= 0 || glow.intensity <= 0) return;

  ctx.save();
  ctx.shadowColor = glow.color;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = glow.color;
  // Les passes se CUMULENT par transparence: l'alpha de chacune est divise pour
  // qu'un cumul de trois reste dans les clous plutot que de saturer a blanc.
  ctx.globalAlpha = clamp01(glow.intensity) / GLOW_PASSES;

  for (let pass = 0; pass < GLOW_PASSES; pass += 1) {
    // Rayons decroissants: le halo se densifie pres des lettres.
    ctx.shadowBlur = radius * (1 - pass / GLOW_PASSES);
    lines.forEach((line, index) => {
      ctx.fillText(line, anchorX, firstLineY + index * lineHeight);
    });
  }

  ctx.restore();
}

/**
 * Style de remplissage d'un texte: degrade s'il y en a un, couleur unie sinon.
 *
 * Le degrade est construit sur la BOITE du texte et non sur la frame, pour
 * qu'un texte deplace garde exactement le meme rendu.
 */
function fillStyleFor(
  ctx: Ctx2D,
  style: TextStyle,
  box: { width: number; height: number },
): string | CanvasGradient {
  if (!style.gradient) return style.color;

  // Le degrade traverse la boite dans la direction demandee. La demi-diagonale
  // garantit qu'il couvre la boite entiere quel que soit l'angle.
  const half = Math.hypot(box.width, box.height) / 2;
  const dx = Math.cos(style.gradient.angle) * half;
  const dy = Math.sin(style.gradient.angle) * half;

  const gradient = ctx.createLinearGradient(-dx, -dy, dx, dy);
  gradient.addColorStop(0, style.gradient.from);
  gradient.addColorStop(1, style.gradient.to);
  return gradient;
}

export function drawTextLayer(
  ctx: Ctx2D,
  layer: TextLayer,
  frameWidth: number,
  frameHeight: number,
): void {
  const { overlay, progressIn, progressOut, pulse } = layer;
  const { style } = overlay;

  const enter = animState(overlay.animation.in, progressIn, true);
  // `progressOut` va de 1 (pas encore sorti) a 0 (sorti): on le passe tel quel,
  // les etats d'animation etant exprimes en "1 = visible".
  const exit = animState(overlay.animation.out, progressOut, false);

  const opacity = enter.opacity * exit.opacity;
  if (opacity <= 0.001) return;

  const text = revealText(overlay.text, enter.reveal);
  if (text.length === 0) return;

  ctx.save();

  ctx.font = fontString(style, frameWidth);
  ctx.textAlign = style.align;
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = opacity;

  /*
    Filtre colorimetrique du texte, meme mecanique que celui des clips.

    Pose sur le contexte, il s'applique a TOUT ce que la couche dessine: lueur,
    contour et remplissage passent ensemble dans le meme look. Les filtrer
    separement donnerait un contour d'une teinte et des lettres d'une autre.
  */
  if (overlay.filter) {
    const css = filterToCss(overlay.filter, frameWidth);
    if (css) ctx.filter = css;
  }

  const maxWidth = overlay.maxWidth * frameWidth;
  const lines = wrapText(ctx, text, maxWidth);
  const fontSize = style.fontSize * frameWidth;
  const lineHeight = fontSize * style.lineHeight;
  const blockHeight = lineHeight * lines.length;

  // Le pulse et les animations d'echelle se composent autour du centre du bloc.
  const centerX = overlay.x * frameWidth;
  const centerY = (overlay.y + enter.translateY + exit.translateY) * frameHeight;

  const scale = enter.scale * exit.scale * (1 + pulse * (overlay.beatPulse?.amount ?? 0));

  ctx.translate(centerX, centerY);
  if (overlay.rotation !== 0) ctx.rotate(overlay.rotation);
  if (scale !== 1) ctx.scale(scale, scale);

  // L'alignement horizontal se fait par rapport au point d'ancrage: apres
  // translation, x=0 est le centre, et textAlign fait le reste.
  const anchorX =
    style.align === 'left' ? -maxWidth / 2 : style.align === 'right' ? maxWidth / 2 : 0;

  const firstLineY = -blockHeight / 2 + lineHeight / 2;

  if (style.background) {
    drawBackground(ctx, lines, {
      anchorX,
      firstLineY,
      lineHeight,
      align: style.align,
      background: style.background,
      frameWidth,
    });
  }

  // `letterSpacing` n'est pas supporte partout: on ne l'applique que si present.
  if (style.letterSpacing !== 0 && 'letterSpacing' in ctx) {
    (ctx as CanvasRenderingContext2D).letterSpacing = `${style.letterSpacing * fontSize}px`;
  }

  /*
    La lueur passe AVANT tout le reste, ombre comprise.

    Peinte apres, elle recouvrirait les lettres d'un voile colore au lieu de
    rayonner autour d'elles. Elle est aussi posee avant que `shadowColor` ne
    soit regle pour l'ombre portee, les deux se disputant le meme etat du
    contexte — d'ou le `save`/`restore` interne a `drawGlow`.
  */
  if (style.glow) {
    drawGlow(ctx, lines, {
      anchorX,
      firstLineY,
      lineHeight,
      glow: style.glow,
      frameWidth,
    });
  }

  if (style.shadow) {
    ctx.shadowColor = style.shadow.color;
    ctx.shadowBlur = style.shadow.blur * frameWidth;
    ctx.shadowOffsetX = style.shadow.x * frameWidth;
    ctx.shadowOffsetY = style.shadow.y * frameWidth;
  }

  // Remplissage resolu une fois pour toutes les lignes: un degre construit par
  // ligne les ferait toutes demarrer a la meme couleur, annulant l'effet sur un
  // bloc de plusieurs lignes.
  const textFill = fillStyleFor(ctx, style, {
    width: maxWidth,
    height: blockHeight,
  });

  /**
   * Longueur cumulee des lignes precedentes, pour repartir la progression.
   *
   * Le surlignage porte sur le BLOC entier: une ligne qui se retrouve coupee en
   * deux par le retour a la ligne automatique doit s'illuminer de gauche a
   * droite puis continuer sur la ligne suivante, pas repartir de zero.
   */
  const totalChars = lines.reduce((sum, line) => sum + line.length, 0);
  let charsBefore = 0;

  lines.forEach((line, index) => {
    const y = firstLineY + index * lineHeight;

    if (style.stroke && style.stroke.width > 0) {
      ctx.lineWidth = style.stroke.width * fontSize;
      ctx.strokeStyle = style.stroke.color;
      // `round` evite les pointes disgracieuses sur les angles vifs.
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(line, anchorX, y);
    }

    // Couche du bas: le texte en attente, dans sa couleur normale.
    ctx.fillStyle = textFill;
    ctx.fillText(line, anchorX, y);

    // Couche du haut: la partie chantee, redessinee par-dessus et rognee au
    // front de progression. Repeindre plutot que decouper le texte en morceaux
    // preserve le rendu exact des ligatures et du crenage.
    if (overlay.karaoke && totalChars > 0) {
      const lineProgress = clamp01(
        (sungChars(layer, totalChars) - charsBefore) / Math.max(1, line.length),
      );
      if (lineProgress > 0) {
        drawSungPart(ctx, line, {
          x: anchorX,
          y,
          progress: lineProgress,
          color: overlay.karaoke.color,
          align: style.align,
          lineHeight,
        });
      }
    }

    charsBefore += line.length;
  });

  ctx.restore();
}

/** Nombre de caracteres deja chantes dans le bloc, en valeur fractionnaire. */
function sungChars(layer: TextLayer, totalChars: number): number {
  return layer.sung * totalChars;
}

/**
 * Redessine la portion chantee d'une ligne, rognee au front de progression.
 *
 * On mesure la largeur reelle du texte avec `measureText` plutot que d'estimer
 * a partir du nombre de caracteres: un « i » et un « W » n'ont pas la meme
 * largeur, et une estimation ferait deriver le front sur les mots.
 */
function drawSungPart(
  ctx: Ctx2D,
  line: string,
  opts: {
    x: number;
    y: number;
    progress: number;
    color: string;
    align: TextStyle['align'];
    lineHeight: number;
  },
): void {
  const { x, y, progress, color, align, lineHeight } = opts;

  const width = ctx.measureText(line).width;
  if (width <= 0) return;

  // Bord gauche du texte, qui depend de l'alignement: `fillText` place le texte
  // par rapport a `x` selon `textAlign`, il faut donc retrouver ce bord pour
  // poser la fenetre de rognage.
  const left = align === 'left' ? x : align === 'right' ? x - width : x - width / 2;

  /**
   * Largeur de la fenetre de rognage, sans marge.
   *
   * Aucune correction de debord n'est necessaire: une bande de pixels semblait
   * rester en couleur d'attente au bord droit, mais la mesure a montre qu'il
   * s'agissait de la fin reellement non chantee du dernier mot. Ajouter une
   * marge aurait fait devancer le front sur le chant.
   */
  const visible = width * clamp01(progress);
  if (visible <= 0) return;

  ctx.save();
  ctx.beginPath();
  // La fenetre est genereuse en hauteur: les jambages descendants et les
  // accents ne doivent pas etre tronques.
  ctx.rect(left, y - lineHeight, visible, lineHeight * 2);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillText(line, x, y);
  ctx.restore();
}

function drawBackground(
  ctx: Ctx2D,
  lines: readonly string[],
  opts: {
    anchorX: number;
    firstLineY: number;
    lineHeight: number;
    align: TextStyle['align'];
    background: NonNullable<TextStyle['background']>;
    frameWidth: number;
  },
): void {
  const { anchorX, firstLineY, lineHeight, align, background, frameWidth } = opts;
  const padding = background.padding * frameWidth;
  const radius = background.radius * frameWidth;

  // Le fond epouse la ligne la plus longue plutot que `maxWidth`: un fond qui
  // depasse largement le texte a l'air casse.
  const widest = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);

  const left =
    align === 'left' ? anchorX : align === 'right' ? anchorX - widest : anchorX - widest / 2;

  const x = left - padding;
  const y = firstLineY - lineHeight / 2 - padding;
  const width = widest + padding * 2;
  const height = lineHeight * lines.length + padding * 2;

  ctx.save();
  ctx.fillStyle = background.color;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius);
  } else {
    ctx.rect(x, y, width, height);
  }
  ctx.fill();
  ctx.restore();
}

/**
 * Canvas intermediaire du masque, reutilise d'une frame a l'autre.
 *
 * Le realloquer a chaque frame ferait un canvas de la taille de l'export 60
 * fois par seconde — le ramasse-miettes devient alors visible a la lecture. Il
 * n'est recree que si les dimensions changent.
 */
let maskCanvas: OffscreenCanvas | null = null;

function maskContext(width: number, height: number): OffscreenCanvasRenderingContext2D | null {
  if (!maskCanvas || maskCanvas.width !== width || maskCanvas.height !== height) {
    maskCanvas = new OffscreenCanvas(width, height);
  }
  // `alpha` par defaut (true): c'est TOUT l'interet de ce canvas.
  const ctx = maskCanvas.getContext('2d');
  if (!ctx) return null;

  /*
    L'etat du contexte est REMIS A NEUF, pas seulement les pixels.

    Piege mesure: `getContext` sur un canvas deja initialise rend le meme
    contexte, avec l'etat laisse par la frame precedente — dont un
    `globalCompositeOperation` reste a `destination-out`. Le voile de la frame
    suivante s'effacait alors lui-meme au lieu d'etre peint, et le masque
    disparaissait purement et simplement des la seconde frame.
  */
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

/**
 * Dessine un masque texte: les lettres laissent voir le montage, le reste est
 * couvert d'une couleur.
 *
 * Le voile et sa decoupe sont peints sur un canvas INTERMEDIAIRE transparent,
 * puis reportes d'un seul `drawImage`. Piege mesure: `destination-out`
 * n'efface rien sur le canvas de sortie, cree en `alpha: false` a l'apercu
 * comme a l'export — il n'y a pas d'alpha a retirer, et la decoupe restait
 * simplement invisible. Le canvas intermediaire, lui, a l'alpha qu'il faut.
 *
 * Decouper au `clip()` sur le texte ne marcherait pas davantage: il faudrait
 * alors REDESSINER les clips dans les lettres, or le compositeur les a deja
 * peints et cette couche ne les connait pas.
 *
 * `inverted` echange les deux operations: les lettres sont peintes pleines au
 * lieu d'etre effacees.
 */
export function drawTextMaskLayer(
  ctx: Ctx2D,
  layer: TextMaskLayer,
  frameWidth: number,
  frameHeight: number,
): void {
  const { mask } = layer;
  if (mask.text.length === 0) return;

  const fontSize = mask.fontSize * frameWidth;
  if (fontSize <= 0) return;

  /*
    Pas de retour a la ligne automatique.

    Un masque est fait de quelques lettres tres grandes — le « A » de l'exemple.
    Les replier sur la largeur de frame les reduirait a la portion congrue, alors
    que deborder du cadre est ici un effet recherche. Les sauts de ligne saisis
    a la main sont en revanche respectes.
  */
  const lines = mask.text.split('\n');
  const lineHeight = fontSize * 1.1;
  const firstLineY = -(lineHeight * (lines.length - 1)) / 2;

  /** Pose les lettres, centrees sur l'ancre et pivotees. */
  const paintLetters = (target: Ctx2D): void => {
    target.save();
    target.translate(mask.x * frameWidth, mask.y * frameHeight);
    if (mask.rotation !== 0) target.rotate(mask.rotation);
    lines.forEach((line, index) => {
      target.fillText(line, 0, firstLineY + index * lineHeight);
    });
    target.restore();
  };

  /** Reglages de police communs aux deux sens. */
  const applyFont = (target: Ctx2D): void => {
    target.font = `${mask.fontWeight} ${fontSize}px ${mask.fontFamily}`;
    target.textAlign = 'center';
    target.textBaseline = 'middle';
    if (mask.letterSpacing !== 0 && 'letterSpacing' in target) {
      (target as CanvasRenderingContext2D).letterSpacing = `${mask.letterSpacing * fontSize}px`;
    }
  };

  if (mask.inverted) {
    /*
      Sens inverse: les lettres sont PLEINES, le reste laisse voir le montage.

      Aucun canvas intermediaire n'est necessaire — rien a effacer, puisque le
      fond doit rester tel quel. La transparence porte alors sur les lettres.
    */
    ctx.save();
    applyFont(ctx);
    ctx.globalAlpha = clamp01(mask.fillOpacity);
    ctx.fillStyle = mask.fillColor;
    paintLetters(ctx);
    ctx.restore();
    return;
  }

  const scratch = maskContext(Math.ceil(frameWidth), Math.ceil(frameHeight));
  if (!scratch) return;

  applyFont(scratch);

  /*
    Le voile est peint SANS transformation, en coordonnees de frame.

    Le poser apres la rotation le ferait pivoter avec le texte et decouvrirait
    les coins de la frame — or il doit la couvrir entierement quel que soit
    l'angle des lettres.
  */
  scratch.fillStyle = mask.fillColor;
  scratch.fillRect(0, 0, frameWidth, frameHeight);

  /*
    Decoupe a alpha PLEIN, quelle que soit l'opacite du voile.

    Le reglage de transparence porte sur le voile, jamais sur la decoupe: une
    decoupe a demi transparente ne retirerait qu'une partie du voile et les
    lettres resteraient grisees — exactement ce qu'on ne veut pas.
  */
  scratch.globalCompositeOperation = 'destination-out';
  paintLetters(scratch);

  // L'opacite du voile s'applique au REPORT: le trou reste franc, seul le
  // voile qui l'entoure s'attenue.
  ctx.save();
  ctx.globalAlpha = clamp01(mask.fillOpacity);
  ctx.drawImage(maskCanvas!, 0, 0, frameWidth, frameHeight);
  ctx.restore();
}
