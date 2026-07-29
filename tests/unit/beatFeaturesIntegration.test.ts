import { describe, expect, it } from 'vitest';

import { analyzeBeats } from '@/audio/beatDetection';
import { featureGrid } from '@/domain/snapping';
import type { AudioTrack, BeatMap } from '@/domain/types';

const SR = 44_100;

/**
 * Morceau synthetique a STRUCTURE connue, en trois parties de 8 s:
 *
 *  1. intro calme: pulsation seule, grave;
 *  2. refrain: fort, avec un aigu brillant;
 *  3. break: tres faible.
 *
 * Il porte donc a la fois un rythme, une dynamique et un changement de couleur —
 * ce qui permet de verifier que les trois criteres remontent bien jusqu'a la
 * grille consommee par l'interface.
 */
function structuredTrack(): Float32Array {
  const bpm = 120;
  const seconds = 24;
  const length = Math.floor(seconds * SR);
  const s = new Float32Array(length);
  const interval = 60 / bpm;
  const clickLength = Math.floor(0.03 * SR);

  for (let index = 0; index * interval < seconds; index += 1) {
    const time = index * interval;
    const start = Math.round(time * SR);
    // Amplitude par partie.
    const gain = time < 8 ? 0.35 : time < 16 ? 1 : 0.06;

    for (let i = 0; i < clickLength && start + i < length; i += 1) {
      const env = Math.exp(-i / (0.004 * SR));
      const kick = Math.sin((2 * Math.PI * 60 * i) / SR);
      const crack = ((i * 2654435761) % 2000) / 1000 - 1;
      s[start + i]! += gain * env * (0.7 * kick + 0.3 * crack);
    }
  }

  /*
    Nappe: grave en parties 1 et 3, brillante en partie 2 — elle porte le
    changement de COULEUR, a l'insu de la pulsation.

    Son amplitude SUIT celle de la partie. Mesure faite: une nappe d'amplitude
    constante ecrasait totalement la dynamique (les trois parties tombaient a
    -16 dB au lieu de -52 / -43 / -67 dB), car le RMS est domine par le signal
    continu et non par les attaques. Une vraie musique ne se comporte pas ainsi:
    quand un morceau retombe, l'accompagnement retombe avec lui.
  */
  for (let i = 0; i < length; i += 1) {
    const time = i / SR;
    const brillant = time >= 8 && time < 16;
    const freq = brillant ? 3200 : 200;
    const padGain = time < 8 ? 0.08 : brillant ? 0.22 : 0.015;
    s[i]! += padGain * Math.sin((2 * Math.PI * freq * i) / SR);
  }

  return s;
}

describe('calages musicaux, chaine complete', () => {
  const beatMap: BeatMap = analyzeBeats(structuredTrack(), SR, 'song');

  it('produit les trois criteres en plus de la pulsation', () => {
    expect(beatMap.features).toBeDefined();
    const features = beatMap.features!;

    // La pulsation reste juste: l'ajout des criteres n'a rien casse.
    expect(Math.abs(beatMap.bpm - 120)).toBeLessThan(2);

    // Dynamique: deux ruptures construites (a 8 s et 16 s).
    expect(features.dynamics.length).toBeGreaterThan(0);
    expect(features.confidence.dynamics).toBeGreaterThan(0);

    // Couleur: le passage de 200 Hz a 3200 Hz doit etre vu.
    expect(features.timbre.length).toBeGreaterThan(0);
  });

  it('trouve les ruptures d energie aux frontieres construites', () => {
    const times = beatMap.features!.dynamics;
    // Au moins une rupture proche de chaque frontiere.
    const near = (target: number) => times.some((t) => Math.abs(t - target) < 1.5);
    expect(near(8)).toBe(true);
    expect(near(16)).toBe(true);
  });

  it('convertit en temps TIMELINE via featureGrid', () => {
    /*
      Le piege du referentiel: la BeatMap est en temps SOURCE, les clips vivent sur
      la timeline. Une piste posee a 5 s et rognee de 2 s decale donc de 3 s.
    */
    const track: AudioTrack = {
      id: 'a1',
      kind: 'audio',
      assetId: 'song',
      role: 'music',
      start: 5,
      source: { in: 2, out: 24 },
      gain: 1,
      muted: false,
      fadeIn: 0,
      fadeOut: 0,
    };

    const sourceTimes = beatMap.features!.dynamics.filter((t) => t >= 2 && t <= 24);
    const grid = featureGrid(beatMap, track, 1, 'dynamics');

    expect(grid.length).toBe(sourceTimes.length);
    for (let i = 0; i < grid.length; i += 1) {
      expect(grid[i]!).toBeCloseTo(sourceTimes[i]! + 3, 6);
    }
  });

  it('renvoie une grille vide pour un critere absent', () => {
    // Sans `features`, l'interface doit griser le critere plutot que d'agir.
    const bare: BeatMap = { ...beatMap, features: undefined };
    expect(featureGrid(bare, undefined, 1, 'sections')).toEqual([]);
    // La pulsation, elle, reste disponible.
    expect(featureGrid(bare, undefined, 1, 'beat').length).toBeGreaterThan(0);
  });
});
