/**
 * Geometrie du cadrage vue de l'APERCU. Module PUR.
 *
 * Repond a une question que le canvas seul ne peut pas poser: ou tombe le plan
 * par rapport au cadre de sortie? Le canvas d'apercu porte deja exactement le
 * ratio de la frame, donc son bord EST le cadre — inutile d'en dessiner un
 * second. Ce qui reste invisible, c'est ce qui deborde (et sera coupe) et ce qui
 * manque (et sortira en fond).
 *
 * Tout est exprime en fractions du CADRE, jamais en pixels: l'appelant multiplie
 * par la taille reelle du canvas, et le meme calcul sert un apercu de 236 px et
 * un canvas de 720 px.
 */

import type { Clip, NormUnit } from './types';

/** Rectangle en fractions du cadre. `0,0` = coin haut-gauche du cadre. */
export interface NormRect {
  x: NormUnit;
  y: NormUnit;
  width: NormUnit;
  height: NormUnit;
}

export interface FramingInfo {
  /** Emprise du plan, en fractions du cadre. Deborde si hors de [0, 1]. */
  content: NormRect;
  /** Le plan sort du cadre: une partie de l'image sera coupee. */
  overflows: boolean;
  /** Le plan ne remplit pas le cadre: du fond sera visible. */
  underfills: boolean;
  /**
   * Part du cadre reellement couverte par le plan, dans [0, 1].
   *
   * 1 = le cadre est plein. C'est la grandeur qui permet de decider s'il faut
   * alerter, sans avoir a comparer quatre bords un par un.
   */
  coverage: number;
}

/**
 * Ou tombe un plan dans le cadre de sortie.
 *
 * `rotation` est volontairement ignoree pour l'emprise. Une image inclinee de
 * quelques degres a une emprise reelle plus large que son rectangle, et la
 * calculer exactement demanderait la boite englobante du rectangle tourne — un
 * calcul juste, mais qui donnerait des reperes changeant a chaque degre, donc
 * illisibles. Les quarts de tour, eux, sont pris en compte: ils echangent
 * franchement largeur et hauteur.
 */
export function framingOf(
  clip: Pick<Clip, 'fit' | 'transform'>,
  source: { width: number; height: number } | undefined,
  frame: { width: number; height: number },
  quarterTurns = 0,
): FramingInfo {
  if (
    !source ||
    source.width <= 0 ||
    source.height <= 0 ||
    frame.width <= 0 ||
    frame.height <= 0
  ) {
    // Sans dimensions, on suppose le cadre plein: afficher une alerte sur un
    // media qu'on n'a pas encore sonde serait un faux positif.
    return {
      content: { x: 0, y: 0, width: 1, height: 1 },
      overflows: false,
      underfills: false,
      coverage: 1,
    };
  }

  // Un quart de tour impair echange les cotes VUS de la source.
  const turned = ((quarterTurns % 2) + 2) % 2 === 1;
  const sourceWidth = turned ? source.height : source.width;
  const sourceHeight = turned ? source.width : source.height;

  const sourceRatio = sourceWidth / sourceHeight;
  const frameRatio = frame.width / frame.height;
  const fillWidth = clip.fit === 'cover' ? sourceRatio < frameRatio : sourceRatio > frameRatio;

  // Meme formule que `fitRect` dans le compositeur, en fractions du cadre.
  const baseWidth = fillWidth ? 1 : frameRatio > 0 ? sourceRatio / frameRatio : 1;
  const baseHeight = fillWidth ? frameRatio / sourceRatio : 1;

  const scale = clip.transform.scale;
  const width = baseWidth * scale;
  const height = baseHeight * scale;

  // Le compositeur decale depuis le CENTRE du cadre.
  const x = 0.5 - width / 2 + clip.transform.x;
  const y = 0.5 - height / 2 + clip.transform.y;

  const content = { x, y, width, height };

  // Tolerance d'un millieme: un `cover` exact produit des largeurs comme
  // 0.9999999 et declencherait une alerte permanente sans elle.
  const epsilon = 1e-3;
  const overflows =
    x < -epsilon || y < -epsilon || x + width > 1 + epsilon || y + height > 1 + epsilon;
  const underfills =
    x > epsilon || y > epsilon || x + width < 1 - epsilon || y + height < 1 - epsilon;

  // Intersection du plan et du cadre, rapportee au cadre.
  const visibleWidth = Math.max(0, Math.min(1, x + width) - Math.max(0, x));
  const visibleHeight = Math.max(0, Math.min(1, y + height) - Math.max(0, y));

  return { content, overflows, underfills, coverage: visibleWidth * visibleHeight };
}
