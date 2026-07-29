/**
 * Aimantation au rythme. Module PUR.
 *
 * Attention au changement de referentiel: une `BeatMap` est exprimee dans le
 * temps de la SOURCE audio, alors que les clips vivent sur la TIMELINE. La
 * piste musicale peut demarrer plus tard (`track.start`) et ne commencer qu'a
 * un certain point de la source (`track.source.in`). Toutes les fonctions
 * publiques ici travaillent en temps TIMELINE et font la conversion.
 */

import { divisionGrid, divisionInterval } from './beatmap';
import { ripple } from './timeline';
import {
  MIN_CLIP_DURATION,
  type AudioTrack,
  type BeatDivision,
  type BeatFeatureKind,
  type BeatMap,
  type Clip,
  type Seconds,
  type VideoTrack,
} from './types';
import { nearestIndex, quantizeToFrame } from '../lib/math';

/** Tolerance d'aimantation par defaut: la moitie d'un intervalle, plafonnee. */
export const MAX_SNAP_TOLERANCE: Seconds = 0.12;

export function defaultTolerance(beatMap: BeatMap, division: BeatDivision): Seconds {
  const interval = divisionInterval(beatMap, division);
  return Math.min(interval / 2, MAX_SNAP_TOLERANCE);
}

/**
 * Grille d'aimantation exprimee en temps TIMELINE.
 *
 * On decale la grille source de `start - source.in` et on ne garde que les
 * points qui tombent dans la plage effectivement couverte par la piste audio:
 * aimanter sur un beat qu'on n'entend pas serait deroutant.
 */
export function timelineGrid(
  beatMap: BeatMap,
  audioTrack: AudioTrack | undefined,
  division: BeatDivision,
): Seconds[] {
  const sourceGrid = divisionGrid(beatMap, division);
  if (!audioTrack) return sourceGrid;

  const offset = audioTrack.start - audioTrack.source.in;
  const audible = { from: audioTrack.source.in, to: audioTrack.source.out };
  const result: Seconds[] = [];
  for (const sourceTime of sourceGrid) {
    if (sourceTime < audible.from || sourceTime > audible.to) continue;
    const timelineTime = sourceTime + offset;
    if (timelineTime >= 0) result.push(timelineTime);
  }
  return result;
}

/**
 * Instants de calage d'un CRITERE, en temps TIMELINE.
 *
 * Le critere `beat` retombe sur `timelineGrid`, donc sur la division choisie. Les
 * autres lisent `beatMap.features` et n'ont pas de division: une rupture d'energie
 * ou une frontiere de section existe a un instant precis, la subdiviser n'aurait
 * aucun sens.
 *
 * Renvoyer un simple `Seconds[]` est ce qui rend l'ajout de criteres bon marche:
 * `distributeTrackOnBeats`, `quantizeTrackBoundaries` et le calage des paroles
 * consomment deja ce type, donc chaque nouveau critere herite de tout l'existant.
 */
export function featureGrid(
  beatMap: BeatMap,
  audioTrack: AudioTrack | undefined,
  division: BeatDivision,
  kind: BeatFeatureKind,
): Seconds[] {
  if (kind === 'beat') return timelineGrid(beatMap, audioTrack, division);

  const features = beatMap.features;
  if (!features) return [];

  // `?? []`: une analyse v3 en cache n'a pas d'`onsets`. Le champ est declare non
  // optionnel car toute analyse NEUVE en produit; c'est la relecture d'un ancien
  // enregistrement qui peut le laisser absent.
  const sourceTimes =
    kind === 'onsets'
      ? (features.onsets ?? [])
      : kind === 'dynamics'
        ? features.dynamics
        : kind === 'sections'
          ? features.sections
          : features.timbre;

  if (!audioTrack) return [...sourceTimes];

  // Meme conversion de referentiel que `timelineGrid`: les instants sont en temps
  // SOURCE, les clips vivent sur la timeline.
  const offset = audioTrack.start - audioTrack.source.in;
  const result: Seconds[] = [];
  for (const sourceTime of sourceTimes) {
    if (sourceTime < audioTrack.source.in || sourceTime > audioTrack.source.out) continue;
    const timelineTime = sourceTime + offset;
    if (timelineTime >= 0) result.push(timelineTime);
  }
  return result;
}

/**
 * Aimante `time` sur la grille si un point est a portee, sinon renvoie `time`
 * inchange. Idempotent: reappliquer la fonction sur son resultat ne change rien.
 */
export function snapTime(
  grid: readonly Seconds[],
  time: Seconds,
  tolerance: Seconds,
): Seconds {
  const index = nearestIndex(grid, time);
  if (index < 0) return time;
  const candidate = grid[index]!;
  return Math.abs(candidate - time) <= tolerance ? candidate : time;
}

/** Premier point de grille strictement apres `time`, ou `null`. */
export function nextGridPointAfter(
  grid: readonly Seconds[],
  time: Seconds,
): Seconds | null {
  for (const point of grid) {
    if (point > time) return point;
  }
  return null;
}

/** Dernier point de grille strictement avant `time`, ou `null`. */
export function previousGridPointBefore(
  grid: readonly Seconds[],
  time: Seconds,
): Seconds | null {
  let result: Seconds | null = null;
  for (const point of grid) {
    if (point >= time) break;
    result = point;
  }
  return result;
}

export interface DistributeOptions {
  division: BeatDivision;
  /** Instant TIMELINE du premier clip. Aimante sur la grille au prealable. */
  startAt?: Seconds;
  /** `each`: un clip par point de grille. `everyN`: un clip tous les N points. */
  mode?: 'each' | 'everyN';
  n?: number;
  fps: number;
}

/**
 * LA fonction cle de l'application: repartit les clips sur les temps.
 *
 * Chaque clip prend la duree separant deux points de grille consecutifs, donc
 * les coupes tombent exactement sur le rythme. Le dernier clip reprend la
 * duree du precedent, car il n'a pas de point de grille suivant.
 *
 * Les clips sont marques `beatLocked` pour que l'UI puisse indiquer qu'ils
 * suivent le rythme (le marquage saute au premier trim manuel).
 */
export function distributeClipsOnBeats(
  clips: readonly Clip[],
  grid: readonly Seconds[],
  options: DistributeOptions,
): Clip[] {
  const { mode = 'each', n = 1, fps } = options;
  if (clips.length === 0) return [];

  const stride = mode === 'everyN' ? Math.max(1, Math.round(n)) : 1;

  /*
    Depart par defaut: le PREMIER point de grille, et non zero.

    Mesure faite sur le cas signale: la musique commencait apres le debut de la
    timeline, donc les premiers intervalles consommes etaient ceux qui precedent
    toute grille utile — les clips heritaient de durees prises AVANT la zone ou
    l'utilisateur voyait les impulsions, d'ou un decalage constant entre les traits
    et les coupes.

    Prendre `grid[0]` aligne le premier clip sur le premier instant reel du critere.
    C'est aussi ce qui rend le critere `onsets` exact: ses points sont irreguliers,
    donc un depart faux ne se rattrape jamais, contrairement a une grille reguliere
    ou l'erreur reste un simple offset.
  */
  const startAt = options.startAt ?? grid[0] ?? 0;

  // On ne garde que les points a partir du depart demande, un sur `stride`.
  const usable = grid.filter((point) => point >= startAt - 1e-9);
  const points: Seconds[] = [];
  for (let i = 0; i < usable.length; i += stride) {
    points.push(usable[i]!);
  }

  if (points.length < 2) {
    // Pas assez de grille pour deduire une duree: on laisse les clips tels quels.
    return ripple(clips, fps);
  }

  const durations: Seconds[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    durations.push(points[i + 1]! - points[i]!);
  }

  const next = clips.map((clip, index) => {
    // Au-dela de la grille disponible, on reutilise la derniere duree connue.
    const duration = durations[index] ?? durations[durations.length - 1]!;
    const bounded = Math.max(MIN_CLIP_DURATION, quantizeToFrame(duration, fps));
    return { ...clip, duration: bounded, beatLocked: true };
  });

  /*
    La piste video demarre a ZERO, meme si le premier point de grille est plus
    tard.

    Un premier essai decalait tout le montage de `points[0]` pour faire coincider
    la premiere coupe avec le premier instant du critere. C'etait faux, et un test
    navigateur existant l'a attrape: `videoDuration` vaut `last.start +
    last.duration` et suppose donc une piste ancree a zero. Le decalage se
    traduisait en frames NOIRES en tete d'export — un reel qui commence sur du
    vide, exactement ce qu'un montage cale sur le rythme ne doit jamais produire.

    Ce qui compte est conserve: les DUREES viennent des intervalles reels du
    critere (voir `startAt` plus haut), donc les coupes suivent le rythme meme si
    la premiere tombe a zero.
  */
  return ripple(next, fps);
}

/**
 * Recale les frontieres existantes sur la grille sans changer le nombre de
 * clips: chaque coupe glisse vers le point de grille le plus proche, dans la
 * limite de la tolerance. Utile quand l'utilisateur a deja un montage et veut
 * seulement le "serrer" sur le rythme.
 */
export function quantizeBoundaries(
  clips: readonly Clip[],
  grid: readonly Seconds[],
  tolerance: Seconds,
  fps: number,
): Clip[] {
  if (clips.length === 0 || grid.length === 0) return [...clips];

  // Frontieres cumulees: [fin clip 0, fin clip 1, ...].
  const boundaries: Seconds[] = [];
  let cursor = 0;
  for (const clip of clips) {
    cursor += clip.duration;
    boundaries.push(cursor);
  }

  const snapped = boundaries.map((boundary) => snapTime(grid, boundary, tolerance));

  // On reconstruit les durees a partir des frontieres aimantees, en garantissant
  // la monotonie: une frontiere ne peut pas passer devant la precedente.
  const next: Clip[] = [];
  let previous = 0;
  for (let i = 0; i < clips.length; i += 1) {
    const target = Math.max(snapped[i]!, previous + MIN_CLIP_DURATION);
    const duration = quantizeToFrame(target - previous, fps);
    const clip = clips[i]!;
    next.push({
      ...clip,
      duration: Math.max(MIN_CLIP_DURATION, duration),
      beatLocked: Math.abs(snapped[i]! - boundaries[i]!) > 1e-9 ? true : clip.beatLocked,
    });
    previous = target;
  }

  return ripple(next, fps);
}

/** Variante travaillant directement sur une piste video. */
export function distributeTrackOnBeats(
  track: VideoTrack,
  grid: readonly Seconds[],
  options: DistributeOptions,
): VideoTrack {
  return { ...track, clips: distributeClipsOnBeats(track.clips, grid, options) };
}

export function quantizeTrackBoundaries(
  track: VideoTrack,
  grid: readonly Seconds[],
  tolerance: Seconds,
  fps: number,
): VideoTrack {
  return { ...track, clips: quantizeBoundaries(track.clips, grid, tolerance, fps) };
}
