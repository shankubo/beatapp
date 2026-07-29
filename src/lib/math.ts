export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Progression normalisee de `from` a `to`, bornee a [0, 1].
 * Renvoie 1 quand l'intervalle est nul (evite une division par zero).
 */
export function progress(value: number, from: number, to: number): number {
  const span = to - from;
  if (span <= 0) return 1;
  return clamp01((value - from) / span);
}

/** Courbe d'accompagnement standard pour les transitions et animations de texte. */
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - clamp01(t), 3);
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/**
 * Arrondit au multiple de 1/fps le plus proche.
 * Les durees de clip sont exprimees en frames entieres: sinon les coupes
 * tombent au milieu d'une frame et l'export derive par rapport a l'apercu.
 */
export function quantizeToFrame(seconds: number, fps: number): number {
  return Math.round(seconds * fps) / fps;
}

/** Somme resistante a l'accumulation d'erreur flottante (algorithme de Neumaier). */
export function accurateSum(values: readonly number[]): number {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const t = sum + value;
    compensation +=
      Math.abs(sum) >= Math.abs(value) ? sum - t + value : value - t + sum;
    sum = t;
  }
  return sum + compensation;
}

/**
 * Recherche dichotomique: index du dernier element <= `target`, ou -1.
 * Utilise pour trouver le beat courant dans un tableau de plusieurs milliers
 * d'entrees a chaque frame, ou une recherche lineaire couterait trop cher.
 */
export function lastIndexAtOrBefore(sorted: readonly number[], target: number): number {
  let low = 0;
  let high = sorted.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sorted[mid]! <= target) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

/** Index de l'element le plus proche de `target`. Renvoie -1 si le tableau est vide. */
export function nearestIndex(sorted: readonly number[], target: number): number {
  if (sorted.length === 0) return -1;
  const before = lastIndexAtOrBefore(sorted, target);
  if (before < 0) return 0;
  if (before === sorted.length - 1) return before;
  const distBefore = target - sorted[before]!;
  const distAfter = sorted[before + 1]! - target;
  return distAfter < distBefore ? before + 1 : before;
}
