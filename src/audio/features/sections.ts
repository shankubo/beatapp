/**
 * Frontieres de SECTIONS: intro, couplet, refrain, pont.
 *
 * Module PUR. Lit le spectre deja calcule par `computeOnsetFunction`.
 *
 * C'est le calage le plus spectaculaire sur un morceau structure: les plans
 * changent aux moments ou la MUSIQUE change de partie, ce qu'aucune grille
 * reguliere ne peut trouver.
 *
 * Methode: chromagramme moyenne par mesure, matrice d'auto-similarite, puis noyau
 * en damier sur la diagonale (Foote). Un maximum de la courbe de nouveaute
 * signale un instant ou « ce qui suit ne ressemble plus a ce qui precede ».
 */

import type { SpectralFrames } from '../beatDetection';

/** Douze classes de hauteur: do, do#, re, ... si. */
const CHROMA_BINS = 12;

/**
 * Demi-largeur du noyau en damier, en fenetres.
 *
 * Avec une fenetre d'une seconde, le noyau couvre 4 s de part et d'autre — assez
 * pour caracteriser une partie, pas trop pour rater une section courte.
 *
 * Il conditionne la duree minimale analysable: il faut `2 x RADIUS + 2` fenetres,
 * soit ~10 s. Mesure: a 8 fenetres de 2 s, un extrait de 20 s ne fournissait que
 * 10 fenetres et l'analyse renoncait — d'ou la fenetre par defaut a 1 s.
 */
const KERNEL_RADIUS = 4;

/** Ecart minimal entre deux frontieres, en secondes: une section est longue. */
const MIN_GAP_SECONDS = 6;

/** Seuil, en multiples de l'ecart type de la nouveaute. */
const THRESHOLD_SIGMA = 1.2;

/**
 * Nouveaute minimale, en absolu.
 *
 * La nouveaute est une difference de similarites cosinus, donc bornee et
 * comparable d'un morceau a l'autre: on peut y poser un plancher absolu, ce qui
 * empeche un seuil purement relatif de trouver des sections dans du bruit.
 */
const MIN_NOVELTY = 0.02;

export interface SectionsResult {
  times: number[];
  confidence: number;
}

/**
 * Detecte les frontieres de sections.
 *
 * `windowSeconds` fixe la granularite: une fenetre par mesure environ. Le
 * sous-echantillonnage est ce qui rend la methode praticable — sur 15 500 trames
 * brutes, une matrice d'auto-similarite complete ferait 240 millions de cellules.
 * Ramenee a ~2 secondes par fenetre, elle tombe a ~90 x 90.
 */
export function detectSections(
  spectrum: SpectralFrames,
  windowSeconds = 1,
): SectionsResult {
  const { frames, binCount, binWidth, frameDuration } = spectrum;
  if (frames.length === 0 || binCount < 16 || frameDuration <= 0) {
    return { times: [], confidence: 0 };
  }

  const framesPerWindow = Math.max(1, Math.round(windowSeconds / frameDuration));
  const windowCount = Math.floor(frames.length / framesPerWindow);
  // Il faut de quoi poser le noyau de part et d'autre, sinon la nouveaute n'a
  // aucun contexte a comparer.
  if (windowCount < KERNEL_RADIUS * 2 + 2) return { times: [], confidence: 0 };

  /*
    Classe de hauteur de chaque bin, precalculee.

    Le repliement sur 12 classes est ce qui rend la comparaison ROBUSTE: deux
    occurrences d'un meme refrain ne sont jamais jouees a l'identique (voix, mix,
    ornements), mais leur contenu harmonique se ressemble. Comparer les spectres
    bruts trouverait des differences partout.
  */
  const chromaOf = new Int8Array(binCount);
  for (let bin = 1; bin < binCount; bin += 1) {
    const freq = bin * binWidth;
    // 69 = la note MIDI du la 440. Sous 20 Hz, aucune hauteur exploitable.
    if (freq < 20) {
      chromaOf[bin] = -1;
      continue;
    }
    const midi = 69 + 12 * Math.log2(freq / 440);
    chromaOf[bin] = ((Math.round(midi) % 12) + 12) % 12;
  }

  // Chromagramme par fenetre, normalise: seule la FORME du vecteur compte, pas le
  // volume — sinon un refrain fort et le meme refrain doux paraitraient differents.
  const chroma: Float32Array[] = [];
  for (let w = 0; w < windowCount; w += 1) {
    const vector = new Float32Array(CHROMA_BINS);
    for (let f = w * framesPerWindow; f < (w + 1) * framesPerWindow; f += 1) {
      const spec = frames[f];
      if (!spec) continue;
      for (let bin = 1; bin < binCount; bin += 1) {
        const cls = chromaOf[bin]!;
        if (cls >= 0) vector[cls]! += spec[bin]!;
      }
    }
    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm);
    if (norm > 1e-6) {
      for (let c = 0; c < CHROMA_BINS; c += 1) vector[c]! /= norm;
    }
    chroma.push(vector);
  }

  /*
    Courbe de nouveaute par noyau en damier.

    On n'assemble PAS la matrice complete: seule la diagonale nous interesse, et
    la calculer a la demande evite d'allouer windowCount^2 flottants.

    Le noyau compare deux blocs: la similarite INTERNE de chaque cote (qui doit
    etre haute — une section se ressemble a elle-meme) contre la similarite CROISEE
    entre les deux (qui doit etre basse a une frontiere).
  */
  const similarity = (a: number, b: number): number => {
    const va = chroma[a];
    const vb = chroma[b];
    if (!va || !vb) return 0;
    let dot = 0;
    for (let c = 0; c < CHROMA_BINS; c += 1) dot += va[c]! * vb[c]!;
    return dot;
  };

  const novelty = new Float32Array(windowCount);
  for (let center = KERNEL_RADIUS; center < windowCount - KERNEL_RADIUS; center += 1) {
    let before = 0;
    let after = 0;
    let across = 0;
    let pairs = 0;

    for (let i = 1; i <= KERNEL_RADIUS; i += 1) {
      for (let j = 1; j <= KERNEL_RADIUS; j += 1) {
        before += similarity(center - i, center - j);
        after += similarity(center + i - 1, center + j - 1);
        across += similarity(center - i, center + j - 1);
        pairs += 1;
      }
    }
    if (pairs === 0) continue;
    // Coherence interne moins ressemblance croisee: eleve a une frontiere.
    novelty[center] = (before + after) / (2 * pairs) - across / pairs;
  }

  let mean = 0;
  let counted = 0;
  for (let i = KERNEL_RADIUS; i < windowCount - KERNEL_RADIUS; i += 1) {
    mean += novelty[i]!;
    counted += 1;
  }
  if (counted === 0) return { times: [], confidence: 0 };
  mean /= counted;

  let variance = 0;
  for (let i = KERNEL_RADIUS; i < windowCount - KERNEL_RADIUS; i += 1) {
    variance += (novelty[i]! - mean) * (novelty[i]! - mean);
  }
  const sigma = Math.sqrt(variance / counted);
  /*
    Plancher sur l'AMPLITUDE de nouveaute, pas seulement sur sa dispersion.

    Un seuil purement relatif (moyenne + k x sigma) trouve toujours quelque chose,
    meme sur un contenu parfaitement homogene ou il ne mesure que du bruit
    numerique. On exige donc en plus que le pic depasse une valeur absolue: la
    nouveaute est une difference de similarites cosinus, donc deja normalisee, et
    0,02 correspond a un changement harmonique reel.
  */
  if (sigma < 1e-4) return { times: [], confidence: 0 };

  const threshold = Math.max(mean + sigma * THRESHOLD_SIGMA, MIN_NOVELTY);
  const minGapWindows = Math.max(1, Math.round(MIN_GAP_SECONDS / windowSeconds));

  const times: number[] = [];
  let lastWindow = -Infinity;
  for (let i = KERNEL_RADIUS; i < windowCount - KERNEL_RADIUS; i += 1) {
    const value = novelty[i]!;
    if (value < threshold) continue;
    if (value < novelty[i - 1]! || value < novelty[i + 1]!) continue;
    if (i - lastWindow < minGapWindows) continue;
    times.push(i * framesPerWindow * frameDuration);
    lastWindow = i;
  }

  const confidence = Math.max(0, Math.min(1, sigma / 0.08));
  return { times, confidence: times.length > 0 ? confidence : 0 };
}
