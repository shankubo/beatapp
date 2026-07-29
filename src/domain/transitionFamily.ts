/**
 * Regroupement des transitions par FAMILLE. Module PUR.
 *
 * Le modele ne connait que des types plats (`slideLeft`, `slideRight`, …): c'est
 * ce qui garde `incomingState` exhaustif et verifiable par le compilateur. Mais
 * une grille de vingt boutons dont douze ne different que par un sens est
 * illisible sur 390 px.
 *
 * Ce module est la seule traduction entre les deux vues: une famille + un sens
 * d'un cote, un type plat de l'autre. L'interface n'a donc aucune table a tenir,
 * et le modele reste inchange — un projet enregistre ne stocke jamais de
 * « famille », toujours un type.
 */

import type { TransitionType } from './types';

/** Sens propose pour une famille directionnelle. */
export type TransitionDirection = 'left' | 'right' | 'up' | 'down';

export const TRANSITION_DIRECTIONS: readonly TransitionDirection[] = [
  'left',
  'right',
  'up',
  'down',
];

/**
 * Identifiant de famille.
 *
 * Pour une transition sans variante, la famille porte le nom du type lui-meme:
 * l'interface traite alors les deux cas par le meme chemin, au lieu de
 * distinguer « bouton simple » et « bouton a sens » a chaque usage.
 */
export type TransitionFamily =
  | 'none'
  | 'fade'
  | 'blurFade'
  | 'slide'
  | 'push'
  | 'wipeLeft'
  | 'paperSlide'
  | 'zoomIn'
  | 'iris'
  | 'shutter'
  | 'whipPan'
  | 'shake'
  | 'glitch'
  | 'flash';

/**
 * Sens disponibles par famille, dans l'ordre d'affichage.
 *
 * `push` n'expose que l'horizontale: le modele n'a pas de `pushUp`/`pushDown`,
 * et en inventer ici afficherait un bouton qui ne peut rien appliquer. La table
 * decrit donc ce qui EXISTE, jamais ce qui serait symetrique.
 */
const FAMILY_DIRECTIONS: Partial<Record<TransitionFamily, readonly TransitionDirection[]>> = {
  slide: TRANSITION_DIRECTIONS,
  paperSlide: TRANSITION_DIRECTIONS,
  push: ['left', 'right'],
};

/**
 * Type plat correspondant a une famille et un sens.
 *
 * Les familles sans variante ignorent le sens: leur nom EST le type.
 */
const DIRECTED_TYPES: Record<string, TransitionType> = {
  'slide:left': 'slideLeft',
  'slide:right': 'slideRight',
  'slide:up': 'slideUp',
  'slide:down': 'slideDown',
  'push:left': 'pushLeft',
  'push:right': 'pushRight',
  'paperSlide:left': 'paperSlideLeft',
  'paperSlide:right': 'paperSlideRight',
  'paperSlide:up': 'paperSlideUp',
  'paperSlide:down': 'paperSlideDown',
};

/** Sens proposes par une famille. Vide = famille sans variante. */
export function directionsFor(family: TransitionFamily): readonly TransitionDirection[] {
  return FAMILY_DIRECTIONS[family] ?? [];
}

/** Une famille propose-t-elle un choix de sens ? */
export function isDirectional(family: TransitionFamily): boolean {
  return directionsFor(family).length > 0;
}

/**
 * Type a appliquer pour une famille et un sens.
 *
 * Retombe sur le PREMIER sens de la famille quand celui demande n'existe pas:
 * passer de « Glisse ↑ » a « Poussee » doit donner « Poussee ←  » et non un
 * etat vide, alors que `push` ne connait pas la verticale. C'est ce qui permet
 * de garder le sens courant en changeant d'effet, sans jamais produire un choix
 * impossible.
 */
export function transitionTypeFor(
  family: TransitionFamily,
  direction: TransitionDirection,
): TransitionType {
  const directions = directionsFor(family);
  if (directions.length === 0) return family as TransitionType;

  const chosen = directions.includes(direction) ? direction : directions[0]!;
  return DIRECTED_TYPES[`${family}:${chosen}`]!;
}

/**
 * Famille et sens d'un type plat — l'operation inverse.
 *
 * Sert a allumer le bon bouton a l'ouverture du panneau, a partir de ce que le
 * projet a enregistre.
 */
export function familyOf(type: TransitionType): {
  family: TransitionFamily;
  direction: TransitionDirection;
} {
  for (const [key, value] of Object.entries(DIRECTED_TYPES)) {
    if (value !== type) continue;
    const [family, direction] = key.split(':') as [TransitionFamily, TransitionDirection];
    return { family, direction };
  }
  // Famille sans variante: le type est son propre nom de famille. Le sens
  // renvoye est neutre et ne sera pas lu, la famille n'en proposant aucun.
  return { family: type as TransitionFamily, direction: 'left' };
}
