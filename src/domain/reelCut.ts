/**
 * Decoupage d'un reel importe en plans editables. Module PUR.
 *
 * Le probleme resolu: une video importee arrive en UN seul plan. Pour en
 * remplacer une image ou en couper un passage, il faut d'abord la trancher — ce
 * qui demandait autant de gestes manuels que de coupes souhaitees.
 *
 * Ce module ne fait qu'une chose: convertir une liste d'INSTANTS en une liste de
 * clips. D'ou viennent ces instants (rythme detecte, changements de plan) ne le
 * regarde pas, et c'est ce qui lui permet de servir les deux methodes de
 * decoupage sans rien dupliquer.
 */

import { MIN_CLIP_DURATION, type Clip, type FrameSpec, type Seconds } from './types';

/**
 * Format de projet aligne sur celui d'une source importee.
 *
 * Sans cet alignement, un reel 9:16 pose dans un projet 16:9 serait recadre par
 * le `cover` par defaut, ou borde de noir en `contain`: l'utilisateur verrait
 * son reel amoindri sans comprendre pourquoi. On importe un reel pour le
 * REPRENDRE, donc son cadre fait autorite.
 *
 * Les cotes sont ramenes a un nombre PAIR: H.264 en 4:2:0 echoue a l'execution
 * sur un cote impair, apres plusieurs secondes d'encodage — la meme contrainte
 * que les paliers de qualite d'export.
 *
 * Le `fps` est conserve: il gouverne la quantification de toute la timeline, et
 * le changer decalerait les durees deja posees.
 */
export function frameForSource(
  current: FrameSpec,
  source: { width?: number; height?: number },
): FrameSpec {
  const { width, height } = source;
  if (!width || !height || !(width > 0) || !(height > 0)) return current;

  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  const next = { width: even(width), height: even(height) };

  // Deja au bon format: on renvoie l'objet d'origine, ce qui evite une entree
  // d'historique pour un changement inexistant.
  if (next.width === current.width && next.height === current.height) return current;

  return { ...current, ...next };
}

/**
 * Duree minimale d'un plan issu d'un decoupage automatique.
 *
 * 0,25 s et non `MIN_CLIP_DURATION` (une frame): le plancher technique autorise
 * un plan de 33 ms, qui n'est pas une image mais un clignotement. Meme valeur
 * que le plancher perceptif des impulsions rythmiques, pour la meme raison.
 */
export const MIN_AUTO_CUT = 0.25;

export interface CutOptions {
  /** Duree totale de la source, en secondes. */
  duration: Seconds;
  /** Instants de coupe, en secondes depuis le debut de la source. */
  cuts: readonly Seconds[];
  /** Vitesse de lecture de la source. 1 = normale. */
  speed?: number;
}

/**
 * Bornes de plans deduites d'une liste d'instants.
 *
 * Renvoie des paires `[debut, fin]` couvrant EXACTEMENT la source, sans trou ni
 * recouvrement: c'est ce qui garantit que le montage decoupe dure aussi
 * longtemps que la video d'origine.
 *
 * Les instants sont assainis avant usage — tries, dedoublonnes, ramenes dans la
 * source, et ceux qui produiraient un plan trop court sont ecartes. Une liste
 * venue d'une detection n'est jamais propre par construction.
 */
export function cutRanges(options: CutOptions): { from: Seconds; to: Seconds }[] {
  const duration = Math.max(0, options.duration);
  if (duration <= MIN_AUTO_CUT) return [{ from: 0, to: duration }];

  const sorted = [...options.cuts]
    .filter((time) => Number.isFinite(time) && time > 0 && time < duration)
    .sort((a, b) => a - b);

  const bounds: Seconds[] = [0];
  for (const time of sorted) {
    const previous = bounds[bounds.length - 1]!;
    // Ecarte les instants trop proches du precedent ET de la fin: un plan de
    // trois frames est un clignotement, pas une image.
    if (time - previous < MIN_AUTO_CUT) continue;
    if (duration - time < MIN_AUTO_CUT) continue;
    bounds.push(time);
  }

  return bounds.map((from, index) => ({
    from,
    to: index + 1 < bounds.length ? bounds[index + 1]! : duration,
  }));
}

/**
 * Clips couvrant la source, un par intervalle.
 *
 * L'appelant fournit les identifiants: le domaine n'en genere pas, c'est la
 * regle du projet. `start` est laisse a zero — `ripple` le recalcule, et
 * l'ecrire ici donnerait deux sources de verite pour la meme valeur.
 */
export function cutIntoClips(
  template: Omit<Clip, 'id' | 'start' | 'duration' | 'source'>,
  ids: readonly string[],
  options: CutOptions,
): Clip[] {
  const speed = options.speed && options.speed > 0 ? options.speed : 1;
  const ranges = cutRanges(options);

  return ranges.slice(0, ids.length).map((range, index) => ({
    ...template,
    id: ids[index]!,
    start: 0,
    // La duree TIMELINE tient compte de la vitesse: un extrait de 2 s joue a
    // 2x n'occupe qu'une seconde de montage.
    duration: Math.max(MIN_CLIP_DURATION, (range.to - range.from) / speed),
    source: { in: range.from, out: range.to, speed },
  }));
}

/**
 * Nombre d'identifiants a fournir pour un decoupage donne.
 *
 * Expose parce que l'appelant doit generer les identifiants AVANT d'appeler
 * `cutIntoClips`, le domaine n'en fabriquant pas.
 */
export function cutCount(options: CutOptions): number {
  return cutRanges(options).length;
}
