/**
 * Helpers de BeatMap. Module PUR.
 *
 * Une `BeatMap` contient une grille reguliere de temps (`beats`), exprimee
 * dans le referentiel de la SOURCE audio. La grille est volontairement sans
 * trou: c'est ce qui permet d'aimanter n'importe ou, meme dans un passage
 * silencieux ou aucun onset n'a ete detecte.
 */

import type { BeatDivision, BeatMap, Seconds } from './types';
import { lastIndexAtOrBefore } from '../lib/math';

/** Sous ce seuil, on avertit l'utilisateur que la detection est incertaine. */
export const LOW_CONFIDENCE_THRESHOLD = 0.4;

export function isLowConfidence(beatMap: BeatMap): boolean {
  return beatMap.confidence < LOW_CONFIDENCE_THRESHOLD;
}

/** Intervalle moyen entre deux pulsations, en secondes. */
export function beatInterval(beatMap: BeatMap): Seconds {
  if (beatMap.bpm > 0) return 60 / beatMap.bpm;
  // Repli: moyenne des ecarts reels si le BPM n'a pas pu etre estime.
  const { beats } = beatMap;
  if (beats.length < 2) return 0;
  return (beats[beats.length - 1]! - beats[0]!) / (beats.length - 1);
}

/** Intervalle correspondant a une division (0.5 = deux temps, 4 = quart de temps). */
export function divisionInterval(beatMap: BeatMap, division: BeatDivision): Seconds {
  const base = beatInterval(beatMap);
  return base > 0 ? base / division : 0;
}

/**
 * Grille de temps pour une division donnee, dans le referentiel de la source.
 *
 * Pour `division === 1` on renvoie les beats detectes tels quels — ils ont ete
 * recales sur les vrais onsets et conservent donc le groove. Pour les autres
 * divisions on interpole entre les beats, ce qui est le comportement musical
 * attendu (un demi-temps tombe a mi-chemin de deux temps).
 */
export function divisionGrid(beatMap: BeatMap, division: BeatDivision): Seconds[] {
  const { beats } = beatMap;
  if (beats.length === 0) return [];
  if (division === 1) return [...beats];

  if (division > 1) {
    // Subdivision: on insere `division - 1` points entre chaque paire de beats.
    const grid: Seconds[] = [];
    for (let i = 0; i < beats.length - 1; i += 1) {
      const from = beats[i]!;
      const to = beats[i + 1]!;
      for (let step = 0; step < division; step += 1) {
        grid.push(from + ((to - from) * step) / division);
      }
    }
    grid.push(beats[beats.length - 1]!);
    return grid;
  }

  // division < 1: on ne garde qu'un beat sur N, en partant du temps fort.
  const stride = Math.round(1 / division);
  const grid: Seconds[] = [];
  const offset = beatMap.barOffset % stride;
  for (let i = offset; i < beats.length; i += stride) {
    grid.push(beats[i]!);
  }
  return grid;
}

/** Temps forts (premier temps de chaque mesure), dans le referentiel source. */
export function downbeats(beatMap: BeatMap): Seconds[] {
  const { beats, beatsPerBar, barOffset } = beatMap;
  const result: Seconds[] = [];
  for (let i = barOffset; i < beats.length; i += beatsPerBar) {
    result.push(beats[i]!);
  }
  return result;
}

/** Force du beat le plus proche de `time`, dans [0, 1]. 0 hors de la grille. */
export function strengthAt(beatMap: BeatMap, time: Seconds, window: Seconds): number {
  const index = lastIndexAtOrBefore(beatMap.beats, time);
  if (index < 0) return 0;
  const beat = beatMap.beats[index]!;
  if (time - beat > window) return 0;
  return beatMap.strength[index] ?? 0;
}

/** Une BeatMap en cache est perimee si l'algorithme a change. */
export function isStale(beatMap: BeatMap, currentAlgoVersion: number): boolean {
  return beatMap.algoVersion !== currentAlgoVersion;
}
