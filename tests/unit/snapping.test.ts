import { describe, expect, it } from 'vitest';

import {
  defaultTolerance,
  distributeClipsOnBeats,
  nextGridPointAfter,
  previousGridPointBefore,
  quantizeBoundaries,
  snapTime,
  timelineGrid,
} from '@/domain/snapping';
import { beatInterval, divisionGrid, downbeats, isLowConfidence } from '@/domain/beatmap';
import { ripple, videoDuration } from '@/domain/timeline';
import { BEAT_ALGO_VERSION, type AudioTrack, type BeatMap, type Clip } from '@/domain/types';

const FPS = 30;

/** BeatMap synthetique a 120 BPM: un temps toutes les 0,5 s. */
function beatMap120(count = 33): BeatMap {
  const beats = Array.from({ length: count }, (_, i) => i * 0.5);
  return {
    assetId: 'audio',
    beats,
    strength: beats.map(() => 1),
    bpm: 120,
    confidence: 0.9,
    barOffset: 0,
    beatsPerBar: 4,
    analyzedAt: 0,
    algoVersion: BEAT_ALGO_VERSION,
  };
}

function clip(id: string, duration: number): Clip {
  return {
    id,
    assetId: `asset_${id}`,
    start: 0,
    duration,
    fit: 'cover',
    transform: { scale: 1, x: 0, y: 0, rotation: 0 },
    muted: false,
  };
}

function audioTrack(overrides: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id: 'atrack',
    kind: 'audio',
    assetId: 'audio',
    role: 'music',
    start: 0,
    source: { in: 0, out: 16 },
    gain: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    ...overrides,
  };
}

describe('beatmap', () => {
  it('deduit l intervalle du BPM', () => {
    expect(beatInterval(beatMap120())).toBeCloseTo(0.5, 10);
  });

  it('renvoie les beats tels quels pour la division 1', () => {
    // Les beats ont ete recales sur les vrais onsets: on ne doit pas les lisser.
    const bm = beatMap120(5);
    expect(divisionGrid(bm, 1)).toEqual(bm.beats);
  });

  it('interpole les demi-temps', () => {
    const grid = divisionGrid(beatMap120(3), 2);
    expect(grid).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('garde un temps sur deux pour la division 0.5', () => {
    const grid = divisionGrid(beatMap120(5), 0.5);
    expect(grid).toEqual([0, 1, 2]);
  });

  it('identifie les temps forts', () => {
    expect(downbeats(beatMap120(9))).toEqual([0, 2, 4]);
  });

  it('signale une detection peu fiable', () => {
    expect(isLowConfidence({ ...beatMap120(), confidence: 0.2 })).toBe(true);
    expect(isLowConfidence(beatMap120())).toBe(false);
  });
});

describe('timelineGrid', () => {
  it('est identique a la grille source quand la piste demarre a zero', () => {
    const bm = beatMap120(5);
    expect(timelineGrid(bm, audioTrack(), 1)).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('decale la grille quand la musique demarre plus tard', () => {
    const grid = timelineGrid(beatMap120(5), audioTrack({ start: 1 }), 1);
    expect(grid).toEqual([1, 1.5, 2, 2.5, 3]);
  });

  it('ignore les beats hors de l extrait audible', () => {
    // On n'utilise que 1s..2s de la source: seuls ces beats comptent.
    const grid = timelineGrid(
      beatMap120(9),
      audioTrack({ start: 0, source: { in: 1, out: 2 } }),
      1,
    );
    // Decalage = start - in = -1, donc 1s source -> 0s timeline.
    expect(grid).toEqual([0, 0.5, 1]);
  });

  it("n'emet jamais de point negatif", () => {
    const grid = timelineGrid(beatMap120(9), audioTrack({ start: 0, source: { in: 0, out: 4 } }), 1);
    expect(grid.every((t) => t >= 0)).toBe(true);
  });
});

describe('snapTime', () => {
  const grid = [0, 0.5, 1, 1.5, 2];

  it('aimante sur le point le plus proche dans la tolerance', () => {
    expect(snapTime(grid, 0.52, 0.12)).toBeCloseTo(0.5, 10);
    expect(snapTime(grid, 0.94, 0.12)).toBeCloseTo(1, 10);
  });

  it('ne fait rien hors tolerance', () => {
    expect(snapTime(grid, 0.75, 0.12)).toBeCloseTo(0.75, 10);
  });

  it('est idempotent', () => {
    const once = snapTime(grid, 0.52, 0.12);
    expect(snapTime(grid, once, 0.12)).toBeCloseTo(once, 10);
  });

  it('gere une grille vide', () => {
    expect(snapTime([], 1.23, 0.12)).toBeCloseTo(1.23, 10);
  });

  it('plafonne la tolerance par defaut', () => {
    // A 120 BPM, la moitie d'un temps vaut 0,25s > plafond de 0,12s.
    expect(defaultTolerance(beatMap120(), 1)).toBeCloseTo(0.12, 10);
    // A la division 4 (quart de temps = 0,125s), la moitie vaut 0,0625s.
    expect(defaultTolerance(beatMap120(), 4)).toBeCloseTo(0.0625, 10);
  });
});

describe('navigation dans la grille', () => {
  const grid = [0, 0.5, 1, 1.5];

  it('trouve le point suivant et precedent', () => {
    expect(nextGridPointAfter(grid, 0.5)).toBeCloseTo(1, 10);
    expect(previousGridPointBefore(grid, 0.5)).toBeCloseTo(0, 10);
  });

  it('renvoie null aux extremites', () => {
    expect(nextGridPointAfter(grid, 1.5)).toBeNull();
    expect(previousGridPointBefore(grid, 0)).toBeNull();
  });
});

describe('distributeClipsOnBeats', () => {
  const grid = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];

  it('donne a chaque clip la duree d un temps', () => {
    const clips = distributeClipsOnBeats([clip('a', 5), clip('b', 0.1), clip('c', 3)], grid, {
      division: 1,
      fps: FPS,
    });
    expect(clips.map((c) => c.duration)).toEqual([0.5, 0.5, 0.5]);
    expect(clips.map((c) => c.start)).toEqual([0, 0.5, 1]);
  });

  it('marque les clips comme cales sur le rythme', () => {
    const clips = distributeClipsOnBeats([clip('a', 5)], grid, { division: 1, fps: FPS });
    expect(clips[0]!.beatLocked).toBe(true);
  });

  it('respecte le mode everyN', () => {
    const clips = distributeClipsOnBeats([clip('a', 1), clip('b', 1)], grid, {
      division: 1,
      mode: 'everyN',
      n: 2,
      fps: FPS,
    });
    // Un clip tous les 2 temps => 1 seconde chacun.
    expect(clips.map((c) => c.duration)).toEqual([1, 1]);
  });

  it('demarre au point demande', () => {
    const clips = distributeClipsOnBeats([clip('a', 1)], grid, {
      division: 1,
      startAt: 2,
      fps: FPS,
    });
    expect(clips[0]!.duration).toBeCloseTo(0.5, 10);
  });

  it('reutilise la derniere duree quand la grille est trop courte', () => {
    const shortGrid = [0, 0.5, 1];
    const clips = distributeClipsOnBeats(
      [clip('a', 9), clip('b', 9), clip('c', 9), clip('d', 9)],
      shortGrid,
      { division: 1, fps: FPS },
    );
    expect(clips.map((c) => c.duration)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('laisse les clips intacts si la grille est insuffisante', () => {
    const clips = distributeClipsOnBeats([clip('a', 2)], [1], { division: 1, fps: FPS });
    expect(clips[0]!.duration).toBeCloseTo(2, 10);
  });

  it('gere une liste de clips vide', () => {
    expect(distributeClipsOnBeats([], grid, { division: 1, fps: FPS })).toEqual([]);
  });

  it('produit un montage dont la duree totale suit le rythme', () => {
    const clips = distributeClipsOnBeats(
      Array.from({ length: 8 }, (_, i) => clip(`c${i}`, 1)),
      grid,
      { division: 1, fps: FPS },
    );
    // 8 clips d'un demi-temps = 4 secondes = 8 temps a 120 BPM.
    expect(videoDuration({ id: 't', kind: 'video', clips })).toBeCloseTo(4, 6);
  });
});

describe('quantizeBoundaries', () => {
  const grid = [0, 0.5, 1, 1.5, 2, 2.5, 3];

  it('recale les coupes proches sans changer le nombre de clips', () => {
    const clips = ripple([clip('a', 0.54), clip('b', 0.48)], FPS);
    const snapped = quantizeBoundaries(clips, grid, 0.12, FPS);
    expect(snapped).toHaveLength(2);
    expect(snapped[0]!.duration).toBeCloseTo(0.5, 6);
    expect(snapped[0]!.start + snapped[0]!.duration).toBeCloseTo(0.5, 6);
    expect(snapped[1]!.start + snapped[1]!.duration).toBeCloseTo(1, 6);
  });

  it('laisse les coupes hors tolerance inchangees', () => {
    // 0,7666..s = 23 frames a 30 fps: deja aligne sur la grille de frames, donc
    // le seul mouvement possible viendrait de l'aimantation. Le point de grille
    // le plus proche (0,5 ou 1) est a plus de 0,05s: rien ne doit bouger.
    const duration = 23 / FPS;
    const clips = ripple([clip('a', duration)], FPS);
    expect(quantizeBoundaries(clips, grid, 0.05, FPS)[0]!.duration).toBeCloseTo(duration, 6);
  });

  it('garde des durees strictement positives meme si les coupes se telescopent', () => {
    // Deux coupes tres proches aimantees sur le meme point de grille.
    const clips = ripple([clip('a', 0.49), clip('b', 0.02), clip('c', 1)], FPS);
    const snapped = quantizeBoundaries(clips, grid, 0.12, FPS);
    expect(snapped.every((c) => c.duration > 0)).toBe(true);
    // Les positions doivent rester strictement croissantes.
    for (let i = 1; i < snapped.length; i += 1) {
      expect(snapped[i]!.start).toBeGreaterThan(snapped[i - 1]!.start);
    }
  });

  it('gere les entrees vides', () => {
    expect(quantizeBoundaries([], grid, 0.1, FPS)).toEqual([]);
    expect(quantizeBoundaries([clip('a', 1)], [], 0.1, FPS)).toHaveLength(1);
  });
});
