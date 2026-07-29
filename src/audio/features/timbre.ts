/**
 * Changements de TIMBRE: les instants ou la musique change de couleur.
 *
 * Module PUR. Lit le spectre deja calcule par `computeOnsetFunction`.
 *
 * Complementaire de la dynamique, et c'est ce qui le rend utile: l'entree d'une
 * nappe de synthe ou l'ouverture d'un filtre peut se faire a volume CONSTANT.
 * L'energie ne bouge pas, la pulsation encore moins, mais la couleur change — et
 * c'est un excellent endroit pour changer de plan.
 */

import type { SpectralFrames } from '../beatDetection';

/** Lissage du centroide, en trames. */
const SMOOTH_FRAMES = 10;

/** Ecart minimal entre deux changements, en secondes. */
const MIN_GAP_SECONDS = 1.2;

/** Seuil, en multiples de l'ecart type de la derivee. */
const THRESHOLD_SIGMA = 2;

export interface TimbreResult {
  times: number[];
  confidence: number;
}

/**
 * Detecte les changements de couleur sonore.
 *
 * On suit le CENTROIDE spectral — le « centre de gravite » du spectre, en Hz.
 * C'est la mesure de brillance la plus directe: un son grave a un centroide bas,
 * un son brillant un centroide haut.
 *
 * Il est calcule en echelle LOG de frequence: perceptuellement, passer de 200 a
 * 400 Hz est le meme saut que de 2000 a 4000 Hz, ce qu'une moyenne en Hz
 * lineaires ne represente pas — elle serait dominee par les aigus.
 */
export function detectTimbre(spectrum: SpectralFrames): TimbreResult {
  const { frames, binCount, binWidth, frameDuration } = spectrum;
  if (frames.length < SMOOTH_FRAMES * 3 || binCount < 8 || frameDuration <= 0) {
    return { times: [], confidence: 0 };
  }

  // Frequence log de chaque bin, precalculee: la boucle interne tourne
  // frameCount x binCount fois, soit des millions d'iterations.
  const logFreq = new Float32Array(binCount);
  for (let bin = 1; bin < binCount; bin += 1) {
    logFreq[bin] = Math.log2(bin * binWidth);
  }

  const centroid = new Float32Array(frames.length);
  for (let frame = 0; frame < frames.length; frame += 1) {
    const spec = frames[frame];
    if (!spec) continue;

    let weighted = 0;
    let total = 0;
    // On demarre au bin 1: le bin 0 est la composante continue, sans hauteur.
    for (let bin = 1; bin < binCount; bin += 1) {
      const magnitude = spec[bin]!;
      weighted += magnitude * logFreq[bin]!;
      total += magnitude;
    }
    // Trame silencieuse: on reprend la precedente plutot que zero, sinon chaque
    // silence produirait deux fausses ruptures (entree et sortie).
    centroid[frame] = total > 1e-6 ? weighted / total : (centroid[frame - 1] ?? 0);
  }

  const smooth = new Float32Array(centroid.length);
  for (let i = 0; i < centroid.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let k = -SMOOTH_FRAMES; k <= SMOOTH_FRAMES; k += 1) {
      const j = i + k;
      if (j >= 0 && j < centroid.length) {
        sum += centroid[j]!;
        count += 1;
      }
    }
    smooth[i] = count > 0 ? sum / count : 0;
  }

  const span = SMOOTH_FRAMES;
  const derivative = new Float32Array(smooth.length);
  for (let i = span; i < smooth.length - span; i += 1) {
    derivative[i] = smooth[i + span]! - smooth[i - span]!;
  }

  let mean = 0;
  for (const value of derivative) mean += value;
  mean /= derivative.length;
  let variance = 0;
  for (const value of derivative) variance += (value - mean) * (value - mean);
  const sigma = Math.sqrt(variance / derivative.length);

  // Sigma en octaves: sous 0,02 octave d'ecart type, le spectre est stable et il
  // n'y a pas de changement de timbre a suivre.
  if (sigma < 0.02) return { times: [], confidence: 0 };

  const threshold = sigma * THRESHOLD_SIGMA;
  const minGapFrames = Math.max(1, Math.round(MIN_GAP_SECONDS / frameDuration));

  const times: number[] = [];
  let lastFrame = -Infinity;
  for (let i = span; i < derivative.length - span; i += 1) {
    const magnitude = Math.abs(derivative[i]!);
    if (magnitude < threshold) continue;
    if (
      magnitude < Math.abs(derivative[i - 1]!) ||
      magnitude < Math.abs(derivative[i + 1]!)
    ) {
      continue;
    }
    if (i - lastFrame < minGapFrames) continue;
    times.push(i * frameDuration);
    lastFrame = i;
  }

  // 0,15 octave d'ecart type traduit un morceau qui change franchement de couleur.
  const confidence = Math.max(0, Math.min(1, sigma / 0.15));
  return { times, confidence: times.length > 0 ? confidence : 0 };
}
