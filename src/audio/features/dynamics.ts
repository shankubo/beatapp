/**
 * Ruptures de DYNAMIQUE: les instants ou la musique change d'intensite.
 *
 * Module PUR: aucun DOM, aucun worker. Il lit le spectre deja calcule par
 * `computeOnsetFunction`, ce qui evite une seconde STFT.
 *
 * C'est le critere de calage le plus rentable. Un montage cale sur chaque temps
 * devient mecanique — tous les plans durent pareil, quoi que fasse la musique.
 * Cale sur l'energie, un plan change quand ca change vraiment: entree de batterie,
 * drop, break. Sur de l'electro, ce seul critere transforme le rendu.
 */

import type { SpectralFrames } from '../beatDetection';

/** Lissage du RMS, en trames. ~12 trames = 140 ms: sous la duree d'une note. */
const SMOOTH_FRAMES = 12;

/**
 * Ecart minimal entre deux ruptures, en secondes.
 *
 * Sans lui, une montee progressive produirait une rupture par trame — 400 instants
 * sur 3 minutes ne calent rien. Une seconde correspond a peu pres a la duree
 * minimale d'un plan qu'on percoit comme un plan.
 */
const MIN_GAP_SECONDS = 1;

/** Seuil de rupture, en multiples de l'ecart type de la derivee. */
const THRESHOLD_SIGMA = 1.8;

export interface DynamicsResult {
  /** Instants de rupture, en secondes, croissants. */
  times: number[];
  /** Fiabilite dans [0, 1]: 0 si la musique n'a pas de relief. */
  confidence: number;
}

/**
 * Detecte les ruptures d'energie.
 *
 * On travaille en DECIBELS et non sur le RMS brut: l'oreille percoit l'intensite
 * de facon logarithmique, et un passage de 0,01 a 0,02 est aussi remarquable qu'un
 * passage de 0,1 a 0,2 — ce qu'une difference lineaire ecraserait.
 */
export function detectDynamics(spectrum: SpectralFrames): DynamicsResult {
  const { rms, frameDuration } = spectrum;
  if (rms.length < SMOOTH_FRAMES * 3 || frameDuration <= 0) {
    return { times: [], confidence: 0 };
  }

  // Conversion en dB, avec un plancher: log(0) est infini.
  const db = new Float32Array(rms.length);
  for (let i = 0; i < rms.length; i += 1) {
    db[i] = 20 * Math.log10(Math.max(1e-6, rms[i]!));
  }

  // Moyenne glissante: la derivee du signal brut serait noyee dans le bruit de
  // trame a trame (chaque attaque de note produirait une "rupture").
  const smooth = new Float32Array(db.length);
  for (let i = 0; i < db.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let k = -SMOOTH_FRAMES; k <= SMOOTH_FRAMES; k += 1) {
      const j = i + k;
      if (j >= 0 && j < db.length) {
        sum += db[j]!;
        count += 1;
      }
    }
    smooth[i] = count > 0 ? sum / count : 0;
  }

  /*
    Derivee sur un ECART et non entre trames voisines.

    Comparer `smooth[i]` a `smooth[i-1]` apres un lissage sur 25 trames donnerait
    une derivee quasi nulle partout: le lissage a deja absorbe la variation locale.
    On compare donc de part et d'autre de la fenetre de lissage.
  */
  const span = SMOOTH_FRAMES;
  const derivative = new Float32Array(db.length);
  for (let i = span; i < db.length - span; i += 1) {
    derivative[i] = smooth[i + span]! - smooth[i - span]!;
  }

  // Ecart type de la derivee: le seuil s'y adapte, donc il vaut pour un morceau
  // tres contraste comme pour un morceau plat.
  let mean = 0;
  for (const value of derivative) mean += value;
  mean /= derivative.length;
  let variance = 0;
  for (const value of derivative) variance += (value - mean) * (value - mean);
  const sigma = Math.sqrt(variance / derivative.length);

  if (sigma < 0.25) {
    // Energie quasi constante: il n'y a pas de dynamique a suivre. On le dit
    // plutot que de renvoyer des ruptures tirees du bruit numerique.
    return { times: [], confidence: 0 };
  }

  const threshold = sigma * THRESHOLD_SIGMA;
  const minGapFrames = Math.max(1, Math.round(MIN_GAP_SECONDS / frameDuration));

  // Selection des maxima locaux de |derivee| au-dela du seuil. On prend la valeur
  // ABSOLUE: une chute d'energie (break) est un point de calage aussi fort qu'une
  // montee, et c'est souvent le plus spectaculaire a l'image.
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

  // Confiance: proportionnelle au relief mesure, bornee. 3 dB d'ecart type sur la
  // derivee correspond a une musique franchement dynamique.
  const confidence = Math.max(0, Math.min(1, sigma / 3));
  return { times, confidence: times.length > 0 ? confidence : 0 };
}
