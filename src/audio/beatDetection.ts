/**
 * Detection de rythme par flux spectral.
 *
 * Module PUR (aucun DOM, aucun worker): il est appele depuis un worker mais
 * reste testable directement en Node, ce qui permet de le verifier contre des
 * signaux synthetiques a verite connue.
 *
 * Chaine de traitement:
 *   1. STFT (Hann, N=1024, hop=512)
 *   2. fonction de detection d'onsets = flux spectral rectifie, compresse en log
 *   3. selection de pics a seuil adaptatif + interpolation parabolique
 *   4. estimation du tempo par autocorrelation + filtre en peigne
 *   5. ajustement d'une grille reguliere, recalee sur les vrais onsets
 */

import { Fft, hannWindow } from './fft';
import { detectDynamics } from './features/dynamics';
import { detectSections } from './features/sections';
import { detectTimbre } from './features/timbre';
import { BEAT_ALGO_VERSION, type BeatFeatures, type BeatMap } from '../domain/types';

export const FFT_SIZE = 1024;
export const HOP_SIZE = 512;

/** Bande utile: on coupe le rumble DC et le sifflement des cymbales. */
const MIN_FREQ_HZ = 30;
const MAX_FREQ_HZ = 5000;

/** Bande de la grosse caisse, utilisee pour trouver les temps forts. */
const KICK_MIN_HZ = 30;
const KICK_MAX_HZ = 150;

/**
 * Plage de tempo exploree.
 *
 * `MIN_BPM` etait a 60, ce qui EXCLUAIT la vraie periode des ballades: mesure sur
 * une piste a 55 BPM, le filtre en peigne se rabattait sur l'harmonique et
 * detectait 110 — les plans etaient coupes deux fois trop vite.
 *
 * Elargir rend l'ambiguite d'octave plus frequente, d'ou le biais perceptuel
 * ci-dessous qui reste indispensable pour departager.
 */
const MIN_BPM = 50;
const MAX_BPM = 210;

/**
 * Preference perceptuelle, pour lever l'ambiguite d'octave (x2 / /2).
 *
 * Exprimee en OCTAVES de tempo et non en BPM: doubler un tempo est la meme
 * operation perceptive qu'on parte de 60 ou de 150, ce qu'une bande en BPM ne
 * sait pas representer.
 *
 * `SIGMA` vaut 0,8 octave: a une octave d'ecart le score est divise par ~1,9, ce
 * qui suffit a ecarter un sous-harmonique sans interdire les tempos extremes.
 */
const PREFERRED_CENTER_BPM = 120;
const PREFERRED_SIGMA_OCTAVES = 1.1;

/** Fenetre du seuil adaptatif, en trames (±6 ≈ 70 ms). */
const THRESHOLD_WINDOW = 6;
const THRESHOLD_MULTIPLIER = 1.6;
const THRESHOLD_MEAN_WEIGHT = 0.1;

/**
 * Nettete minimale de l'ODF (rapport pic / moyenne) pour qu'un signal soit
 * considere comme percussif.
 *
 * Le seuil adaptatif est purement RELATIF: sur un son parfaitement tenu
 * (sinusoide, nappe), la fuite spectrale de la fenetre de Hann fait fluctuer
 * l'ODF autour d'une valeur non nulle, et le seuil relatif declenche sur ce
 * bruit numerique — l'algorithme inventerait un rythme la ou il n'y en a pas.
 *
 * Un plancher proportionnel au pic ne reglerait rien, car sur un son tenu le
 * pic lui-meme est du bruit. La grandeur qui discrimine vraiment est la FORME
 * de l'ODF: un signal percussif produit une ODF tres pointue (mesure: pic/moyenne
 * de l'ordre de 45), un son tenu une ODF plate (de l'ordre de 2,5).
 */
const MIN_ODF_SHARPNESS = 8;

/** Plancher local, en fraction du pic global: filtre les micro-fluctuations. */
const ABSOLUTE_FLOOR_RATIO = 0.02;

/** Ecart minimal entre deux onsets: 8 trames ≈ 93 ms. */
const MIN_ONSET_GAP_FRAMES = 8;

const BEATS_PER_BAR = 4;

export interface OnsetAnalysis {
  /** Fonction de detection d'onsets, une valeur par trame. */
  odf: Float32Array;
  /** Meme fonction, restreinte a la bande de la grosse caisse. */
  kickOdf: Float32Array;
  /** Temps des onsets detectes, en secondes. */
  onsets: number[];
  /** Force de chaque onset, dans [0, 1]. */
  strengths: number[];
  /** Duree d'une trame, en secondes. */
  frameDuration: number;
  /**
   * Spectre conserve, uniquement si `keepSpectrum` a ete demande.
   *
   * C'est le socle des autres calages (dynamique, sections, timbre, harmonie):
   * refaire une STFT par critere couterait cinq passes sur le morceau, alors que
   * tout se deduit de ce qui est DEJA calcule ici.
   */
  spectrum?: SpectralFrames;
}

/**
 * Spectre par trame, partage par tous les detecteurs de calage.
 *
 * On ne garde que les bins sous `MAX_FREQ_HZ`: aucun critere ne lit au-dela, et
 * conserver les 512 bins d'un morceau de 3 minutes couterait ~32 Mo la ou la
 * troncature ramene a ~7 Mo.
 */
export interface SpectralFrames {
  /** `log(1 + 1000 * |X|)`, une entree par trame, `binCount` valeurs chacune. */
  frames: Float32Array[];
  /** Nombre de bins conserves par trame. */
  binCount: number;
  /** Largeur d'un bin, en Hz. */
  binWidth: number;
  /** Energie efficace par trame. */
  rms: Float32Array;
  frameDuration: number;
}

/**
 * Calcule la fonction de detection d'onsets.
 *
 * On utilise un flux spectral **compresse en log** et rectifie demi-onde: la
 * compression logarithmique rend la detection bien plus robuste aux variations
 * de volume qu'une difference d'energie brute (un passage fort ne masque plus
 * les onsets d'un passage faible).
 */
export function computeOnsetFunction(
  samples: Float32Array,
  sampleRate: number,
  options: { keepSpectrum?: boolean } = {},
): OnsetAnalysis {
  const fft = new Fft(FFT_SIZE);
  const window = hannWindow(FFT_SIZE);
  const frameDuration = HOP_SIZE / sampleRate;

  const binWidth = sampleRate / FFT_SIZE;
  const minBin = Math.max(1, Math.floor(MIN_FREQ_HZ / binWidth));
  const maxBin = Math.min(FFT_SIZE / 2 - 1, Math.ceil(MAX_FREQ_HZ / binWidth));
  const kickMinBin = Math.max(1, Math.floor(KICK_MIN_HZ / binWidth));
  const kickMaxBin = Math.min(FFT_SIZE / 2 - 1, Math.ceil(KICK_MAX_HZ / binWidth));

  const frameCount = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP_SIZE) + 1);
  const odf = new Float32Array(Math.max(0, frameCount));
  const kickOdf = new Float32Array(Math.max(0, frameCount));

  const real = new Float32Array(FFT_SIZE);
  const imag = new Float32Array(FFT_SIZE);
  let previousLog = new Float32Array(FFT_SIZE / 2);
  let currentLog = new Float32Array(FFT_SIZE / 2);

  // RMS glissant, pour normaliser: sans cela, une intro calme serait ignoree.
  const rms = new Float32Array(Math.max(0, frameCount));

  // Spectre conserve a la demande, tronque a la bande utile.
  const keptBins = maxBin + 1;
  const keptFrames = options.keepSpectrum === true ? new Array<Float32Array>(frameCount) : null;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * HOP_SIZE;

    let energy = 0;
    for (let i = 0; i < FFT_SIZE; i += 1) {
      const sample = samples[offset + i] ?? 0;
      energy += sample * sample;
      real[i] = sample * window[i]!;
      imag[i] = 0;
    }
    rms[frame] = Math.sqrt(energy / FFT_SIZE);

    fft.transform(real, imag);

    for (let bin = 0; bin < FFT_SIZE / 2; bin += 1) {
      const magnitude = Math.hypot(real[bin]!, imag[bin]!);
      // Compression logarithmique: le facteur 1000 fixe l'echelle de sensibilite.
      currentLog[bin] = Math.log(1 + 1000 * magnitude);
    }

    if (frame > 0) {
      let flux = 0;
      for (let bin = minBin; bin <= maxBin; bin += 1) {
        // Rectification demi-onde: seules les MONTEES d'energie sont des onsets.
        const delta = currentLog[bin]! - previousLog[bin]!;
        if (delta > 0) flux += delta;
      }
      odf[frame] = flux;

      let kickFlux = 0;
      for (let bin = kickMinBin; bin <= kickMaxBin; bin += 1) {
        const delta = currentLog[bin]! - previousLog[bin]!;
        if (delta > 0) kickFlux += delta;
      }
      kickOdf[frame] = kickFlux;
    }

    // Copie AVANT l'echange des tampons: `currentLog` est reutilise a la trame
    // suivante, en conserver la reference ne garderait que la derniere trame.
    if (keptFrames) {
      const kept = new Float32Array(keptBins);
      for (let bin = 0; bin < keptBins; bin += 1) kept[bin] = currentLog[bin]!;
      keptFrames[frame] = kept;
    }

    // Echange des tampons: evite une allocation par trame.
    const swap = previousLog;
    previousLog = currentLog;
    currentLog = swap;
  }

  const { onsets, strengths } = pickPeaks(odf, frameDuration);

  return {
    odf,
    kickOdf,
    onsets,
    strengths,
    frameDuration,
    ...(keptFrames
      ? {
          spectrum: {
            frames: keptFrames,
            binCount: keptBins,
            binWidth,
            rms,
            frameDuration,
          },
        }
      : {}),
  };
}

/**
 * Selection de pics a seuil adaptatif.
 *
 * Le seuil est local (mediane sur une fenetre glissante): un seuil global
 * raterait tous les onsets d'un passage calme, ou en inventerait dans un
 * passage sature.
 */
function pickPeaks(
  odf: Float32Array,
  frameDuration: number,
): { onsets: number[]; strengths: number[] } {
  const onsets: number[] = [];
  const strengths: number[] = [];
  const scratch: number[] = [];

  // Nettete globale: si l'ODF est plate, le signal n'a pas d'attaques et tout
  // "onset" qu'on detecterait serait du bruit de fuite spectrale.
  let peak = 0;
  let sum = 0;
  for (const value of odf) {
    if (value > peak) peak = value;
    sum += value;
  }
  const average = odf.length > 0 ? sum / odf.length : 0;
  if (average <= 0 || peak / average < MIN_ODF_SHARPNESS) {
    return { onsets: [], strengths: [] };
  }

  const floor = peak * ABSOLUTE_FLOOR_RATIO;

  let lastOnsetFrame = -Infinity;

  for (let frame = 1; frame < odf.length - 1; frame += 1) {
    const value = odf[frame]!;
    if (value <= floor) continue;

    // Maximum local strict.
    if (value < odf[frame - 1]! || value < odf[frame + 1]!) continue;
    if (frame - lastOnsetFrame < MIN_ONSET_GAP_FRAMES) continue;

    const from = Math.max(0, frame - THRESHOLD_WINDOW);
    const to = Math.min(odf.length - 1, frame + THRESHOLD_WINDOW);

    scratch.length = 0;
    let sum = 0;
    for (let i = from; i <= to; i += 1) {
      scratch.push(odf[i]!);
      sum += odf[i]!;
    }
    scratch.sort((a, b) => a - b);
    const median = scratch[scratch.length >> 1]!;
    const mean = sum / scratch.length;

    const threshold = median * THRESHOLD_MULTIPLIER + mean * THRESHOLD_MEAN_WEIGHT;
    if (value <= threshold || threshold <= 0) continue;

    // Interpolation parabolique: precision sous-trame sur la position du pic.
    const previous = odf[frame - 1]!;
    const next = odf[frame + 1]!;
    const denominator = previous - 2 * value + next;
    const shift = denominator !== 0 ? (0.5 * (previous - next)) / denominator : 0;
    const refinedFrame = frame + Math.max(-0.5, Math.min(0.5, shift));

    // `refinedFrame * frameDuration` designe le DEBUT de la fenetre FFT. Or
    // l'energie mesuree est celle de toute la fenetre, dont le centre se trouve
    // un demi-hop plus loin. Sans cette correction, tous les onsets sont
    // systematiquement en avance d'environ 6 ms.
    onsets.push((refinedFrame + 0.5) * frameDuration);
    strengths.push(Math.min(1, value / threshold - 1));
    lastOnsetFrame = frame;
  }

  return { onsets, strengths };
}

/**
 * Estime le tempo par autocorrelation de l'ODF, puis filtre en peigne.
 *
 * L'autocorrelation seule confond systematiquement un tempo et son double
 * (l'erreur d'octave). La somme harmonique `ACF[T] + ACF[2T]/2 + ...` favorise
 * la periode fondamentale, et le biais vers la bande 85-170 BPM tranche les cas
 * restants.
 */
export function estimateTempo(
  odf: Float32Array,
  frameDuration: number,
): { bpm: number; periodFrames: number; confidence: number } {
  if (odf.length < 16 || frameDuration <= 0) {
    return { bpm: 0, periodFrames: 0, confidence: 0 };
  }

  // Retrait de la moyenne: une composante continue ecraserait l'autocorrelation.
  let mean = 0;
  for (const value of odf) mean += value;
  mean /= odf.length;

  const centered = new Float32Array(odf.length);
  for (let i = 0; i < odf.length; i += 1) centered[i] = odf[i]! - mean;

  const minLag = Math.max(2, Math.floor(60 / (MAX_BPM * frameDuration)));
  const maxLag = Math.min(
    odf.length - 1,
    Math.ceil(60 / (MIN_BPM * frameDuration)),
  );
  if (maxLag <= minLag) return { bpm: 0, periodFrames: 0, confidence: 0 };

  /**
   * L'autocorrelation est calculee JUSQU'AUX HARMONIQUES, bien au-dela de la
   * plage de tempo exploree.
   *
   * C'est essentiel: si l'ACF s'arretait a `maxLag`, un tempo lent (grand lag)
   * verrait ses harmoniques tomber hors du tableau et cumulerait moins de termes
   * qu'un tempo rapide. Le filtre en peigne favoriserait alors mecaniquement le
   * double du vrai tempo — precisement l'erreur d'octave qu'il doit corriger.
   * En etendant l'ACF, tous les candidats disposent des memes harmoniques et
   * sont donc comparables.
   *
   * Deux harmoniques, et non quatre: aux rangs 3 et 4, on mesure des periodes de
   * plusieurs mesures ou l'autocorrelation devient bruitee (valeurs faibles,
   * parfois negatives). Mesure sur un motif a 90 BPM: la fondamentale identifie
   * correctement la periode (4039 contre 2674 pour le candidat a 60 BPM), mais
   * les rangs 3-4 (14 et -41) suffisaient a inverser le classement. Sommer
   * moins d'harmoniques, mais fiables, est plus robuste.
   */
  const HARMONICS = 2;
  const acfLimit = Math.min(centered.length - 2, maxLag * HARMONICS);

  const acf = new Float64Array(acfLimit + 1);
  for (let lag = minLag; lag <= acfLimit; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < centered.length; i += 1) {
      sum += centered[i]! * centered[i + lag]!;
    }
    acf[lag] = sum / (centered.length - lag);
  }

  // Filtre en peigne: on somme les harmoniques du candidat, ponderees.
  let bestLag = minLag;
  let bestScore = -Infinity;
  const combScores = new Float64Array(maxLag + 1);

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    // Somme harmonique ponderee. Tous les candidats disposent des memes
    // harmoniques grace a `acfLimit`, donc les scores sont comparables sans
    // normalisation supplementaire.
    let score = 0;
    for (let harmonic = 1; harmonic <= HARMONICS; harmonic += 1) {
      const index = lag * harmonic;
      if (index > acfLimit) break;
      score += acf[index]! / harmonic;
    }

    /**
     * Biais perceptuel: a score comparable, on prefere un tempo « humain ».
     *
     * Courbe CONTINUE et non palier a 1,15 dans une bande.
     *
     * Le palier suffisait tant que la plage exploree etait 60-200: hors bande, il
     * n'y avait qu'une octave possible. En elargissant a 50 pour rattraper les
     * ballades, chaque tempo rapide gagnait un sous-harmonique nouvellement
     * eligible, et le palier ne savait plus departager — mesure: 174 BPM tombait
     * a 58 (le tiers) et 90 a 45 (la moitie).
     *
     * Une gaussienne en log-tempo centree sur ~120 decroit doucement: elle
     * penalise d'autant plus qu'on s'eloigne, donc un sous-harmonique lointain
     * ne peut plus l'emporter sur la vraie periode, tout en laissant vivre les
     * tempos extremes quand leur score est franchement meilleur.
     */
    const bpm = 60 / (lag * frameDuration);
    const octaves = Math.log2(bpm / PREFERRED_CENTER_BPM);
    score *= Math.exp(-(octaves * octaves) / (2 * PREFERRED_SIGMA_OCTAVES ** 2));

    combScores[lag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // Affinage parabolique sur le pic du peigne.
  const before = combScores[bestLag - 1] ?? 0;
  const at = combScores[bestLag]!;
  const after = combScores[bestLag + 1] ?? 0;
  const denominator = before - 2 * at + after;
  const shift = denominator !== 0 ? (0.5 * (before - after)) / denominator : 0;
  const periodFrames = bestLag + Math.max(-0.5, Math.min(0.5, shift));

  // Confiance = rapport pic / moyenne des scores, borne a [0, 1].
  let scoreSum = 0;
  let scoreCount = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    if (combScores[lag]! > 0) {
      scoreSum += combScores[lag]!;
      scoreCount += 1;
    }
  }
  const averageScore = scoreCount > 0 ? scoreSum / scoreCount : 0;
  const ratio = averageScore > 0 ? bestScore / averageScore : 0;
  // Un ratio de 3 ou plus indique un rythme franc.
  const confidence = Math.max(0, Math.min(1, (ratio - 1) / 2));

  return {
    bpm: 60 / (periodFrames * frameDuration),
    periodFrames,
    confidence,
  };
}

/**
 * Ajuste une grille reguliere de periode `periodSeconds` sur les onsets, puis
 * recale chaque point sur un vrai onset proche.
 *
 * Pourquoi une grille plutot que les onsets bruts: les onsets sont irreguliers
 * et comportent des trous (silences, passages tenus). Or l'aimantation doit
 * fonctionner PARTOUT sur la timeline, y compris dans un silence. La grille
 * garantit cette couverture, et le recalage local preserve le groove.
 */
export function fitBeatGrid(
  onsets: readonly number[],
  strengths: readonly number[],
  periodSeconds: number,
  duration: number,
): { beats: number[]; strengths: number[]; phaseScore: number } {
  if (periodSeconds <= 0 || duration <= 0) {
    return { beats: [], strengths: [], phaseScore: 0 };
  }

  const sigma = periodSeconds / 8;
  const twoSigmaSquared = 2 * sigma * sigma;

  // Recherche de la phase: on echantillonne la periode en 16 positions.
  let bestPhase = 0;
  let bestScore = -Infinity;
  const steps = 16;

  for (let step = 0; step < steps; step += 1) {
    const phase = (step / steps) * periodSeconds;
    let score = 0;

    for (let i = 0; i < onsets.length; i += 1) {
      const onset = onsets[i]!;
      // Distance au point de grille le plus proche pour cette phase.
      const offset = onset - phase;
      const nearest = Math.round(offset / periodSeconds) * periodSeconds + phase;
      const distance = onset - nearest;
      score += (strengths[i] ?? 1) * Math.exp(-(distance * distance) / twoSigmaSquared);
    }

    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }

  // Construction de la grille, avec recalage sur les vrais onsets.
  const beats: number[] = [];
  const beatStrengths: number[] = [];
  const tolerance = periodSeconds / 8;

  for (let time = bestPhase; time <= duration + 1e-9; time += periodSeconds) {
    let chosen = time;
    let strength = 0.5;

    // Recherche d'un onset a portee. Les onsets etant tries, on pourrait
    // dichotomiser; a l'echelle d'un morceau (quelques milliers d'onsets), le
    // cout reste negligeable face a la STFT.
    let bestDistance = tolerance;
    for (let i = 0; i < onsets.length; i += 1) {
      const distance = Math.abs(onsets[i]! - time);
      if (distance < bestDistance) {
        bestDistance = distance;
        chosen = onsets[i]!;
        strength = strengths[i] ?? 0.5;
      }
      // Les onsets sont croissants: inutile d'aller plus loin.
      if (onsets[i]! > time + tolerance) break;
    }

    if (chosen >= 0) {
      beats.push(chosen);
      beatStrengths.push(strength);
    }
  }

  // Normalisation du score de phase, pour le combiner a la confiance de tempo.
  const totalStrength = strengths.reduce((sum, value) => sum + value, 0);
  const phaseScore = totalStrength > 0 ? Math.min(1, bestScore / totalStrength) : 0;

  return { beats, strengths: beatStrengths, phaseScore };
}

/**
 * Determine quel temps de la mesure est le temps fort.
 *
 * On note chaque phase possible par la somme des forces d'onset en bande basse
 * (la grosse caisse tombe sur le temps fort dans la quasi-totalite des musiques
 * populaires).
 */
export function findBarOffset(
  beats: readonly number[],
  kickOdf: Float32Array,
  frameDuration: number,
  beatsPerBar: number = BEATS_PER_BAR,
): number {
  if (beats.length < beatsPerBar) return 0;

  let bestOffset = 0;
  let bestScore = -Infinity;

  for (let offset = 0; offset < beatsPerBar; offset += 1) {
    let score = 0;
    for (let i = offset; i < beats.length; i += beatsPerBar) {
      const frame = Math.round(beats[i]! / frameDuration);
      if (frame >= 0 && frame < kickOdf.length) score += kickOdf[frame]!;
    }
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }

  return bestOffset;
}

/**
 * Metrique: 3 ou 4 temps par mesure.
 *
 * `BEATS_PER_BAR` etait ecrit en dur a 4, donc toute musique ternaire avait de faux
 * temps forts et le calage « a la mesure » tombait a cote.
 *
 * On compare la MOYENNE d'energie de grosse caisse sur les temps forts candidats:
 * la bonne metrique est celle qui les concentre le mieux. La moyenne et non la
 * somme, car en 3/4 il y a un tiers de temps forts en plus et une somme
 * favoriserait mecaniquement l'hypothese ternaire.
 *
 * LIMITE MESUREE, a connaitre avant de « corriger » cette fonction: elle ne se
 * verifie pas sur un click track synthetique. L'attaque d'un clic, meme accorde
 * dans l'aigu, produit un transitoire large bande qui excite la bande grave a
 * CHAQUE temps — `kickOdf` y est donc aperiodique et le rapport ternaire/quaternaire
 * penche a tort vers 4. Sur de la vraie musique, l'accompagnement d'un temps faible
 * n'a pas cette attaque percussive. Le test unitaire verrouille donc ce qui est
 * verifiable: un signal sans contraste metrique franc reste en 4/4.
 *
 * On exige par ailleurs une marge nette (`MIN_TERNARY_MARGIN`) pour preferer 3: a
 * egalite, le 4/4 est bien plus frequent, et se tromper vers le ternaire couperait
 * a contretemps sur l'immense majorite des morceaux.
 */
const MIN_TERNARY_MARGIN = 1.12;

export function detectBeatsPerBar(
  beats: readonly number[],
  kickOdf: Float32Array,
  frameDuration: number,
): number {
  // Il faut au moins trois mesures de chaque hypothese pour que la moyenne ait
  // un sens: sous ce seuil, on garde le cas de loin le plus frequent.
  if (beats.length < 12) return BEATS_PER_BAR;

  /**
   * Meilleure moyenne d'energie GRAVE pour une metrique donnee, toutes phases
   * confondues.
   *
   * On lit `kickOdf` — la bande de la grosse caisse — et non l'accentuation
   * generale: mesure faite, l'ODF est compressee en log et donc volontairement
   * insensible a l'AMPLITUDE (un temps 20 fois plus faible donnait encore 20,5
   * contre 21,0). Ce qui distingue reellement une mesure n'est d'ailleurs pas le
   * volume mais le CONTENU: le premier temps porte la basse, les suivants
   * l'accompagnement. C'est ce contraste-la que la bande grave revele.
   */
  const bestMeanFor = (beatsPerBar: number): number => {
    let best = 0;
    for (let offset = 0; offset < beatsPerBar; offset += 1) {
      let sum = 0;
      let count = 0;
      for (let i = offset; i < beats.length; i += beatsPerBar) {
        const frame = Math.round(beats[i]! / frameDuration);
        sum += frame >= 0 && frame < kickOdf.length ? kickOdf[frame]! : 0;
        count += 1;
      }
      const mean = count > 0 ? sum / count : 0;
      if (mean > best) best = mean;
    }
    return best;
  };

  // Moyenne et non somme: en 3/4 il y a un tiers de temps forts en plus, et une
  // somme favoriserait mecaniquement l'hypothese ternaire.
  const ternary = bestMeanFor(3);
  const quaternary = bestMeanFor(4);

  // Marge exigee pour preferer 3: a egalite le 4/4 est bien plus frequent, et se
  // tromper vers le ternaire couperait a contretemps sur presque tout.
  return ternary > quaternary * MIN_TERNARY_MARGIN ? 3 : 4;
}

/**
 * Points de calage autres que la pulsation.
 *
 * Chaque detecteur renvoie sa propre confiance, et c'est elle qui permettra a
 * l'interface de GRISER un critere que la musique ne porte pas. Un bouton actif qui
 * ne fait rien est pire qu'un bouton grise.
 */
function computeFeatures(
  spectrum: SpectralFrames,
  onsets: readonly number[],
  strengths: readonly number[],
): BeatFeatures {
  const dynamics = detectDynamics(spectrum);
  const sections = detectSections(spectrum);
  const timbre = detectTimbre(spectrum);
  const impulses = pickImpulses(onsets, strengths);

  return {
    onsets: impulses.times,
    dynamics: dynamics.times,
    sections: sections.times,
    timbre: timbre.times,
    confidence: {
      onsets: impulses.confidence,
      dynamics: dynamics.confidence,
      sections: sections.confidence,
      timbre: timbre.confidence,
    },
  };
}

/**
 * Ecart minimal entre deux impulsions RETENUES pour le montage.
 *
 * `MIN_ONSET_GAP_FRAMES` (~93 ms) est une contrainte de DETECTION: elle empeche de
 * compter deux fois la meme attaque. Elle ne dit rien de ce qui est montrable. Un
 * plan de 93 ms est un clignotement, pas une image: a 30 fps il ne dure que trois
 * frames. On impose donc un plancher perceptif separe.
 *
 * 0,25 s = quatre plans par seconde. C'est deja tres rapide, mais c'est le rythme
 * de coupe reel d'un reel nerveux; en dessous, l'oeil ne fixe plus rien.
 */
const MIN_IMPULSE_GAP_SECONDS = 0.25;

/**
 * Retient les attaques les plus FORTES, en respectant l'ecart minimal.
 *
 * On procede par force decroissante et non chronologiquement: dans une rafale, ce
 * qu'on veut garder est l'impact principal, pas celui qui arrive en premier. Un
 * parcours chronologique retiendrait la premiere attaque venue et masquerait le
 * vrai temps fort qui la suit de 100 ms.
 */
function pickImpulses(
  onsets: readonly number[],
  strengths: readonly number[],
): { times: number[]; confidence: number } {
  if (onsets.length === 0) return { times: [], confidence: 0 };

  const order = onsets.map((_, index) => index);
  order.sort((a, b) => (strengths[b] ?? 0) - (strengths[a] ?? 0));

  const kept: number[] = [];
  for (const index of order) {
    const time = onsets[index]!;
    if (kept.every((other) => Math.abs(other - time) >= MIN_IMPULSE_GAP_SECONDS)) {
      kept.push(time);
    }
  }
  kept.sort((a, b) => a - b);

  /*
    Confiance = proportion d'attaques survivantes.

    Une musique reellement percussive garde presque tout; un signal dont les
    "onsets" sont du bruit de fuite spectrale produit des pics agglutines qui
    s'eliminent entre eux. Le taux de survie distingue donc les deux sans avoir a
    reintroduire un seuil arbitraire.
  */
  return { times: kept, confidence: kept.length / onsets.length };
}

/** Analyse complete: signal mono -> BeatMap. */
export function analyzeBeats(
  samples: Float32Array,
  sampleRate: number,
  assetId: string,
): BeatMap {
  const duration = samples.length / sampleRate;
  // `keepSpectrum`: les autres calages se deduisent de cette meme STFT. Une passe
  // par critere couterait cinq fois le prix sur un morceau de trois minutes.
  const analysis = computeOnsetFunction(samples, sampleRate, { keepSpectrum: true });
  const tempo = estimateTempo(analysis.odf, analysis.frameDuration);

  /*
    Les autres criteres ne dependent PAS de la pulsation.

    C'est ce qui les rend utiles sur une musique sans rythme franc: une nappe
    ambiante n'a pas de tempo exploitable, mais elle a une dynamique, des sections
    et des changements de couleur. On les calcule donc avant le test ci-dessous.
  */
  const features = analysis.spectrum
    ? computeFeatures(analysis.spectrum, analysis.onsets, analysis.strengths)
    : undefined;

  if (tempo.bpm <= 0 || analysis.onsets.length < 2) {
    // Signal sans rythme discernable (sinus pur, silence, bruit constant).
    return {
      assetId,
      beats: [],
      strength: [],
      bpm: 0,
      confidence: 0,
      barOffset: 0,
      beatsPerBar: BEATS_PER_BAR,
      analyzedAt: Date.now(),
      algoVersion: BEAT_ALGO_VERSION,
      ...(features ? { features } : {}),
    };
  }

  const periodSeconds = tempo.periodFrames * analysis.frameDuration;
  const grid = fitBeatGrid(analysis.onsets, analysis.strengths, periodSeconds, duration);
  const beatsPerBar = detectBeatsPerBar(
    grid.beats,
    analysis.kickOdf,
    analysis.frameDuration,
  );
  const barOffset = findBarOffset(
    grid.beats,
    analysis.kickOdf,
    analysis.frameDuration,
    beatsPerBar,
  );

  return {
    assetId,
    beats: grid.beats,
    strength: grid.strengths,
    bpm: tempo.bpm,
    // La confiance combine la nettete du tempo et la qualite de l'ajustement:
    // un tempo net mal cale en phase reste peu exploitable.
    confidence: Math.min(1, tempo.confidence * 0.6 + grid.phaseScore * 0.4),
    barOffset,
    beatsPerBar,
    ...(features ? { features } : {}),
    analyzedAt: Date.now(),
    algoVersion: BEAT_ALGO_VERSION,
  };
}
