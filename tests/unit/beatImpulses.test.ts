import { describe, expect, it } from 'vitest';

import { analyzeBeats } from '@/audio/beatDetection';
import { distributeClipsOnBeats, featureGrid } from '@/domain/snapping';
import type { AudioTrack, Clip } from '@/domain/types';

const SR = 44_100;

/**
 * Motif volontairement IRREGULIER, aux instants imposes.
 *
 * C'est le coeur du critere: une grille reguliere ne peut pas le reproduire, donc
 * un test qui passerait avec `beat` ne prouverait rien. Les ecarts alternent
 * 0,30 / 0,45 / 0,75 s — trois valeurs distinctes, toutes au-dessus du plancher
 * perceptif de 0,25 s.
 */
const HITS = [0.5, 0.8, 1.25, 2.0, 2.3, 2.75, 3.5, 3.8, 4.25, 5.0];

function irregularTrack(): Float32Array {
  const seconds = 6;
  const length = Math.floor(seconds * SR);
  const s = new Float32Array(length);
  const clickLength = Math.floor(0.03 * SR);

  for (const time of HITS) {
    const start = Math.round(time * SR);
    for (let i = 0; i < clickLength && start + i < length; i += 1) {
      const env = Math.exp(-i / (0.004 * SR));
      const kick = Math.sin((2 * Math.PI * 60 * i) / SR);
      const crack = ((i * 2654435761) % 2000) / 1000 - 1;
      s[start + i]! += env * (0.7 * kick + 0.3 * crack);
    }
  }
  return s;
}

describe('critere impulsions', () => {
  const beatMap = analyzeBeats(irregularTrack(), SR, 'song');

  it('retrouve les attaques reelles aux instants construits', () => {
    const onsets = beatMap.features!.onsets;
    expect(onsets.length).toBeGreaterThan(0);

    // Chaque impact construit doit avoir une impulsion proche.
    for (const hit of HITS) {
      const found = onsets.some((t) => Math.abs(t - hit) < 0.06);
      expect(found, `impact a ${hit}s`).toBe(true);
    }
  });

  it('respecte le plancher perceptif de 0,25 s', () => {
    const onsets = beatMap.features!.onsets;
    for (let i = 1; i < onsets.length; i += 1) {
      expect(onsets[i]! - onsets[i - 1]!).toBeGreaterThanOrEqual(0.25 - 1e-9);
    }
  });

  it('produit des ecarts IRREGULIERS, contrairement a la pulsation', () => {
    const onsets = beatMap.features!.onsets;
    const gaps: number[] = [];
    for (let i = 1; i < onsets.length; i += 1) gaps.push(onsets[i]! - onsets[i - 1]!);

    // Au moins deux ecarts nettement differents: c'est ce que la grille reguliere
    // est structurellement incapable de rendre.
    const min = Math.min(...gaps);
    const max = Math.max(...gaps);
    expect(max - min).toBeGreaterThan(0.2);

    // La grille de pulsation, elle, est bien reguliere — verification du contraste.
    const beats = beatMap.beats;
    const beatGaps: number[] = [];
    for (let i = 1; i < beats.length; i += 1) beatGaps.push(beats[i]! - beats[i - 1]!);
    if (beatGaps.length > 2) {
      expect(Math.max(...beatGaps) - Math.min(...beatGaps)).toBeLessThan(0.12);
    }
  });

  it('donne aux clips les durees entre impacts successifs', () => {
    const grid = featureGrid(beatMap, undefined, 1, 'onsets');
    const clips: Clip[] = Array.from({ length: 4 }, (_, i) => ({
      id: `c${i}`,
      assetId: `asset_c${i}`,
      start: 0,
      duration: 1,
      fit: 'cover',
      transform: { scale: 1, x: 0, y: 0, rotation: 0 },
      muted: false,
    }));

    const out = distributeClipsOnBeats(clips, grid, { division: 1, fps: 30 });

    /*
      La piste demarre a ZERO: `videoDuration` suppose cette ancre, et decaler le
      montage produirait des frames noires en tete d'export.

      Ce qui doit suivre le rythme, ce sont les DUREES: chaque clip prend
      l'intervalle separant deux impulsions consecutives.
    */
    expect(out[0]!.start).toBe(0);

    for (let i = 0; i < out.length - 1; i += 1) {
      const expected = grid[i + 1]! - grid[i]!;
      expect(out[i]!.duration, `duree du clip ${i}`).toBeCloseTo(expected, 1);
    }

    // Et le montage reste contigu.
    let cursor = 0;
    for (const clip of out) {
      expect(clip.start).toBeCloseTo(cursor, 6);
      cursor += clip.duration;
    }
  });

  it('convertit en temps timeline comme les autres criteres', () => {
    const track: AudioTrack = {
      id: 'a1',
      kind: 'audio',
      assetId: 'song',
      role: 'music',
      start: 5,
      source: { in: 1, out: 6 },
      gain: 1,
      muted: false,
      fadeIn: 0,
      fadeOut: 0,
    };

    const sourceTimes = beatMap.features!.onsets.filter((t) => t >= 1 && t <= 6);
    const grid = featureGrid(beatMap, track, 1, 'onsets');

    expect(grid.length).toBe(sourceTimes.length);
    for (let i = 0; i < grid.length; i += 1) {
      expect(grid[i]!).toBeCloseTo(sourceTimes[i]! + 4, 6);
    }
  });

  it('reste vide sur une analyse anterieure, sans planter', () => {
    // Une BeatMap v3 en cache n'a pas d'`onsets`: l'UI doit griser, pas casser.
    const legacy = {
      ...beatMap,
      features: { ...beatMap.features!, onsets: undefined as unknown as number[] },
    };
    expect(featureGrid(legacy, undefined, 1, 'onsets')).toEqual([]);
  });
});
