/**
 * Lecture des fichiers de paroles horodatees. Module PUR.
 *
 * Deux formats, parce qu'ils couvrent tout ce qu'un utilisateur trouve:
 * - `.lrc`, le format karaoke: `[mm:ss.cc] texte`, un horodatage par ligne;
 * - `.srt`, le format sous-titres: un index, une plage `debut --> fin`, du texte.
 *
 * Ces fichiers portent DEJA le calage, ce qui en fait la meilleure source
 * possible: on n'a rien a deviner. Le calage sur les beats detectes reste
 * propose en option, pour les fichiers dont l'horodatage derive.
 *
 * Le module est pur et ne connait ni le DOM ni le stockage: il transforme du
 * texte en lignes. C'est ce qui le rend testable sans navigateur.
 */

import { newId } from '../lib/id';
import type { LyricLine, Seconds } from './types';

/** Duree accordee a la derniere ligne d'un `.lrc`, qui n'a pas de fin. */
const TRAILING_LINE_DURATION: Seconds = 3;

/** Duree minimale d'une ligne: en deca, elle serait illisible. */
const MIN_LINE_DURATION: Seconds = 0.3;

export type LyricsFileFormat = 'lrc' | 'srt';

export interface ParsedLyricsFile {
  format: LyricsFileFormat;
  lines: LyricLine[];
}

/**
 * Devine le format d'apres le contenu, jamais d'apres l'extension.
 *
 * Meme raison que la validation des medias par magic bytes: un nom de fichier
 * est une affirmation de l'utilisateur, pas une preuve. Un `.txt` contenant du
 * LRC doit fonctionner, et un `.lrc` mal nomme ne doit pas faire echouer
 * l'import.
 */
export function detectLyricsFormat(raw: string): LyricsFileFormat | null {
  // Une plage `-->` est la signature du SRT et n'existe pas en LRC.
  if (/\d\d:\d\d:\d\d[,.]\d{1,3}\s*-->/.test(raw)) return 'srt';
  if (/\[\d{1,3}:\d\d(?:[.:]\d{1,3})?\]/.test(raw)) return 'lrc';
  return null;
}

/**
 * Lit un fichier de paroles, quel que soit son format.
 *
 * Renvoie `null` si le contenu ne ressemble a aucun des deux formats: l'appelant
 * peut alors proposer de le traiter comme du texte simple a coller, ce qui est
 * plus utile qu'une erreur.
 */
export function parseLyricsFile(raw: string): ParsedLyricsFile | null {
  const format = detectLyricsFormat(raw);
  if (format === null) return null;

  const lines = format === 'srt' ? parseSrt(raw) : parseLrc(raw);
  return lines.length > 0 ? { format, lines } : null;
}

/**
 * `.lrc`: `[mm:ss.cc] texte`.
 *
 * Une ligne peut porter PLUSIEURS horodatages (`[00:12.00][01:30.00] refrain`),
 * facon compacte d'ecrire un refrain qui revient: chacun produit sa propre
 * ligne, sinon le refrain n'apparaitrait qu'une fois.
 *
 * Les balises de metadonnees (`[ar:]`, `[ti:]`, `[offset:]`) sont ignorees, sauf
 * `offset` qui decale reellement tous les temps — c'est sa raison d'etre dans le
 * format.
 */
export function parseLrc(raw: string): LyricLine[] {
  const offsetMatch = /\[offset:\s*(-?\d+)\s*\]/i.exec(raw);
  // `offset` est en millisecondes, et POSITIF signifie "avancer les paroles",
  // donc on le retranche.
  const offset = offsetMatch ? -Number(offsetMatch[1]) / 1000 : 0;

  const stamped: { start: Seconds; text: string }[] = [];

  for (const line of raw.split(/\r?\n/)) {
    // On collecte tous les horodatages en tete, puis le reste est le texte.
    const stamps: Seconds[] = [];
    let rest = line;

    for (;;) {
      const match = /^\s*\[(\d{1,3}):(\d\d(?:[.:]\d{1,3})?)\]/.exec(rest);
      if (!match) break;
      const minutes = Number(match[1]);
      const seconds = Number(match[2]!.replace(':', '.'));
      stamps.push(minutes * 60 + seconds);
      rest = rest.slice(match[0].length);
    }

    const text = rest.trim();
    // Un horodatage sans texte est un marqueur d'instrumental: on l'ecarte, mais
    // il reste utile comme borne de fin pour la ligne precedente.
    for (const start of stamps) stamped.push({ start: start + offset, text });
  }

  // Un `.lrc` n'est pas garanti trie, notamment avec des refrains compacts.
  stamped.sort((a, b) => a.start - b.start);

  return toLines(stamped);
}

/**
 * `.srt`: bloc numerote, plage `hh:mm:ss,mmm --> hh:mm:ss,mmm`, puis texte.
 *
 * La fin est explicite, donc chaque ligne porte sa vraie duree — contrairement
 * au LRC ou elle se deduit de la ligne suivante.
 */
export function parseSrt(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const pattern =
    /(\d\d):(\d\d):(\d\d)[,.](\d{1,3})\s*-->\s*(\d\d):(\d\d):(\d\d)[,.](\d{1,3})/;

  // Les blocs sont separes par une ligne vide.
  for (const block of raw.split(/\r?\n\s*\r?\n/)) {
    const rows = block.split(/\r?\n/);
    const timeIndex = rows.findIndex((row) => pattern.test(row));
    if (timeIndex < 0) continue;

    const match = pattern.exec(rows[timeIndex]!)!;
    const start = srtTime(match[1]!, match[2]!, match[3]!, match[4]!);
    const end = srtTime(match[5]!, match[6]!, match[7]!, match[8]!);

    // Le texte suit la ligne de temps; un sous-titre sur deux lignes garde son
    // retour a la ligne, que le rendu canvas sait deja gerer.
    const text = rows
      .slice(timeIndex + 1)
      .join('\n')
      .trim();
    if (text.length === 0) continue;

    lines.push({
      id: newId('lyric'),
      text,
      start,
      duration: Math.max(MIN_LINE_DURATION, end - start),
    });
  }

  return lines.sort((a, b) => a.start - b.start);
}

function srtTime(h: string, m: string, s: string, ms: string): Seconds {
  // Les millisecondes peuvent etre ecrites sur 1 a 3 chiffres: on complete a
  // droite, sinon `,5` vaudrait 5 ms au lieu de 500.
  const fraction = Number(ms.padEnd(3, '0')) / 1000;
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + fraction;
}

/**
 * Deduit les durees d'une suite d'instants: chaque ligne court jusqu'a la
 * suivante.
 *
 * Les entrees sans texte (marqueurs d'instrumental) bornent la ligne precedente
 * puis disparaissent — c'est exactement leur role dans le format.
 */
function toLines(stamped: readonly { start: Seconds; text: string }[]): LyricLine[] {
  const lines: LyricLine[] = [];

  for (let index = 0; index < stamped.length; index += 1) {
    const entry = stamped[index]!;
    if (entry.text.length === 0) continue;

    const next = stamped[index + 1];
    const end = next ? next.start : entry.start + TRAILING_LINE_DURATION;

    // Un horodatage negatif apres application de l'offset n'a pas de sens.
    if (entry.start < 0) continue;

    lines.push({
      id: newId('lyric'),
      text: entry.text,
      start: entry.start,
      duration: Math.max(MIN_LINE_DURATION, end - entry.start),
    });
  }

  return lines;
}

/**
 * Decale et tronque des lignes importees pour qu'elles tiennent dans le reel.
 *
 * Un fichier de paroles couvre la chanson entiere, alors qu'un reel n'en garde
 * que quelques secondes: sans cela, la quasi-totalite des lignes tomberait hors
 * du montage et l'import paraitrait n'avoir rien fait.
 *
 * @param from Instant de la CHANSON qui correspond au debut du reel.
 */
export function fitLinesToReel(
  lines: readonly LyricLine[],
  options: { from: Seconds; until: Seconds },
): LyricLine[] {
  const { from, until } = options;

  return lines
    .map((line) => ({ ...line, start: line.start - from }))
    // Une ligne qui se termine avant le debut du reel n'a rien a y faire.
    .filter((line) => line.start + line.duration > 0 && line.start < until)
    .map((line) => {
      // Une ligne a cheval sur le debut est ramenee a zero, sa fin conservee.
      const start = Math.max(0, line.start);
      const end = Math.min(until, line.start + line.duration);
      return { ...line, start, duration: Math.max(MIN_LINE_DURATION, end - start) };
    });
}
