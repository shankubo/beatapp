/**
 * Paroles synchronisees. Module PUR.
 *
 * Il n'y a PAS de transcription automatique: aucun modele de reconnaissance
 * vocale n'existe dans le navigateur, et envoyer l'audio a un service externe
 * contredirait la promesse "rien ne quitte l'appareil". L'utilisateur colle donc
 * les paroles, et c'est le calage sur la grille rythmique — la partie penible —
 * qui est automatise ici.
 *
 * Les lignes produites sont converties en `TextOverlay` par `lyricOverlays`: le
 * compositeur ne connait que les overlays, et les paroles n'ajoutent donc aucun
 * cas particulier au moteur de rendu.
 */

import { newId } from '../lib/id';
import { clamp01 } from '../lib/math';
import type { LyricLine, Lyrics, Seconds, TextOverlay } from './types';

/** Duree par defaut d'une ligne quand aucune grille rythmique n'est disponible. */
export const DEFAULT_LINE_DURATION: Seconds = 2.5;

/**
 * Decoupe un texte colle en lignes.
 *
 * Une ligne par retour a la ligne, les lignes vides servant de separateur de
 * couplet et etant simplement ignorees.
 */
export function parseLyricLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Cale les lignes sur la grille rythmique.
 *
 * Chaque ligne occupe `beatsPerLine` points de grille, ce qui reproduit la
 * structure d'une chanson: en 4/4, une ligne par mesure. La derniere ligne
 * s'etend jusqu'a `until` afin de ne pas disparaitre avant la fin du reel.
 *
 * @param grid Points de grille en temps TIMELINE (voir `timelineGrid`).
 * @param until Fin du reel: les lignes au-dela sont tronquees puis ecartees.
 */
export function alignLyricsToBeats(
  texts: readonly string[],
  grid: readonly Seconds[],
  options: { beatsPerLine: number; startAt?: Seconds; until: Seconds },
): LyricLine[] {
  const { beatsPerLine, until } = options;
  const step = Math.max(1, Math.round(beatsPerLine));

  // Sans grille, on repartit regulierement: mieux vaut un calage approximatif
  // que pas de paroles du tout.
  if (grid.length < 2) {
    return distributeEvenly(texts, options.startAt ?? 0, until);
  }

  const startAt = options.startAt ?? 0;
  // Premier point de grille utilisable: on ne fait pas apparaitre une ligne
  // avant le debut demande.
  let index = grid.findIndex((point) => point >= startAt - 1e-6);
  if (index < 0) index = 0;

  const lines: LyricLine[] = [];

  for (const text of texts) {
    const start = grid[index];
    if (start === undefined || start >= until) break;

    const nextIndex = index + step;
    // Au-dela de la grille, on prolonge du dernier intervalle connu plutot que
    // de couper la ligne net.
    const end = grid[nextIndex] ?? start + lastInterval(grid) * step;

    lines.push({
      id: newId('lyric'),
      text,
      start,
      duration: Math.max(0.1, Math.min(end, until) - start),
    });

    index = nextIndex;
  }

  return lines;
}

/** Intervalle moyen des derniers points, pour prolonger au-dela de la grille. */
function lastInterval(grid: readonly Seconds[]): Seconds {
  const last = grid[grid.length - 1]!;
  const previous = grid[grid.length - 2]!;
  return Math.max(0.1, last - previous);
}

/** Repartition uniforme, quand il n'y a pas d'analyse rythmique. */
function distributeEvenly(
  texts: readonly string[],
  startAt: Seconds,
  until: Seconds,
): LyricLine[] {
  const available = Math.max(0, until - startAt);
  if (available <= 0 || texts.length === 0) return [];

  const duration = Math.min(DEFAULT_LINE_DURATION, available / texts.length);

  return texts.map((text, index) => ({
    id: newId('lyric'),
    text,
    start: startAt + index * duration,
    duration,
  }));
}

/**
 * Convertit les paroles en incrustations de texte.
 *
 * Les paroles partagent un style et une position: c'est ce qui les distingue de
 * textes libres, et ce qui permet de les restyler d'un seul geste. Le
 * compositeur, lui, ne voit que des `TextOverlay` ordinaires.
 */
export function lyricOverlays(lyrics: Lyrics): TextOverlay[] {
  const karaoke = lyrics.karaoke?.enabled === true ? lyrics.karaoke : undefined;

  return lyrics.lines.map((line) => ({
    id: line.id,
    text: line.text,
    start: line.start,
    duration: line.duration,
    x: lyrics.x,
    y: lyrics.y,
    maxWidth: lyrics.maxWidth,
    rotation: 0,
    style: lyrics.style,
    animation: lyrics.animation,
    // Le surlignage voyage AVEC l'incrustation: le compositeur n'a donc pas a
    // connaitre l'existence des paroles, il dessine une incrustation qui se
    // trouve porter une progression.
    ...(karaoke
      ? { karaoke: { color: karaoke.color, words: line.words } }
      : {}),
  }));
}

/**
 * Fraction de la ligne deja chantee a l'instant `time`, dans [0, 1].
 *
 * C'est LA fonction du karaoke, et elle est pure: le compositeur s'en sert pour
 * savoir ou couper entre la couleur « chantee » et la couleur d'attente.
 *
 * Deux regimes, selon ce que la source a fourni:
 *
 * - **avec mots horodates** (Whisper): la progression est mesuree. On avance mot
 *   par mot, et A L'INTERIEUR du mot courant on interpole sur sa duree — sans
 *   cela le surlignage sauterait par blocs et paraitrait saccade.
 * - **sans mots**: on interpole lineairement sur la duree de la ligne. C'est
 *   approximatif, et c'est assume: mieux vaut un balayage regulier que pas de
 *   karaoke du tout pour des paroles collees.
 *
 * La fraction porte sur les CARACTERES et non sur les mots, parce que c'est en
 * caracteres que le rendu mesure la largeur du texte. Un mot long doit occuper
 * proportionnellement plus de surlignage qu'un mot court.
 */
export function sungFraction(line: LyricLine, time: Seconds): number {
  const end = line.start + line.duration;
  if (time <= line.start) return 0;
  if (time >= end) return 1;

  const words = line.words;
  if (!words || words.length === 0) {
    // Pas de mots: balayage regulier sur la duree de la ligne.
    return (time - line.start) / line.duration;
  }

  const total = words.reduce((sum, word) => sum + word.text.length, 0);
  if (total === 0) return 0;

  let consumed = 0;
  for (const word of words) {
    if (time >= word.end) {
      consumed += word.text.length;
      continue;
    }
    if (time <= word.start) break;

    // Dans le mot courant: on interpole sur sa duree pour que le front avance
    // continument au lieu de sauter d'un mot a l'autre.
    const span = word.end - word.start;
    const within = span > 0 ? (time - word.start) / span : 1;
    consumed += word.text.length * within;
    break;
  }

  return clamp01(consumed / total);
}

/** Ligne active a l'instant donne, pour la mise en evidence dans l'editeur. */
export function activeLyricIndex(lines: readonly LyricLine[], time: Seconds): number {
  return lines.findIndex(
    (line) => time >= line.start && time < line.start + line.duration,
  );
}
