/**
 * Traduction d'un filtre en chaine CSS. Module PUR.
 *
 * Extrait de `Compositor` pour que `TextRenderer` puisse l'utiliser sans creer
 * de cycle d'import: le compositeur importe deja le renderer de texte, donc
 * l'inverse etait impossible. Les clips et les textes partagent ainsi
 * exactement la meme table de looks, au lieu d'en tenir deux.
 */

import type { ClipFilter } from '../domain/types';
import { clamp01, lerp } from '../lib/math';

/** Arrondi a 4 decimales: evite les chaines a rallonge dues aux flottants. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Chaine CSS d'un filtre, ou `null` s'il ne modifie rien.
 *
 * `intensity` dose le look en interpolant depuis l'identite: un seul curseur
 * suffit alors a atténuer un preset, sans avoir a redefinir chaque composante.
 *
 * Le flou est exprime en unites normalisees et multiplie par `frameWidth`: sans
 * cela, un flou de 2 px serait quatre fois plus prononce sur l'apercu a 270 px
 * que sur l'export a 1080 px — une divergence apercu/export visible.
 */
export function filterToCss(filter: ClipFilter, frameWidth: number): string | null {
  const amount = clamp01(filter.intensity);
  if (amount <= 0) return null;

  // Interpolation depuis l'identite de chaque composante.
  const brightness = lerp(1, filter.brightness, amount);
  const contrast = lerp(1, filter.contrast, amount);
  const saturation = lerp(1, filter.saturation, amount);
  const hueRotate = lerp(0, filter.hueRotate, amount);
  const sepia = lerp(0, filter.sepia, amount);
  const blur = lerp(0, filter.blur, amount) * frameWidth;

  const parts: string[] = [];
  if (brightness !== 1) parts.push(`brightness(${round(brightness)})`);
  if (contrast !== 1) parts.push(`contrast(${round(contrast)})`);
  if (saturation !== 1) parts.push(`saturate(${round(saturation)})`);
  if (hueRotate !== 0) parts.push(`hue-rotate(${round(hueRotate)}deg)`);
  if (sepia !== 0) parts.push(`sepia(${round(sepia)})`);
  if (blur >= 0.1) parts.push(`blur(${round(blur)}px)`);

  return parts.length > 0 ? parts.join(' ') : null;
}
