import { describe, expect, it } from 'vitest';

import {
  CLIP_ZOOM_STEP,
  MAX_CLIP_SCALE,
  MIN_CLIP_SCALE,
  steppedScale,
} from '@/domain/project';

describe('steppedScale', () => {
  it('multiplie et divise par le meme pas', () => {
    expect(steppedScale(1, 1)).toBeCloseTo(CLIP_ZOOM_STEP, 9);
    expect(steppedScale(1, -1)).toBeCloseTo(1 / CLIP_ZOOM_STEP, 9);
  });

  it('revient a la valeur de depart apres un aller-retour', () => {
    // Loin des bornes, zoomer puis dezoomer doit rendre l'image identique. Un
    // pas additif (+0,15) ne le garantirait pas: 1 + 0,15 - 0,15 marche, mais
    // 0,3 + 0,15 - 0,15 aussi alors que le RAPPORT visuel, lui, differe.
    for (const start of [0.5, 0.8, 1, 1.4, 2]) {
      const roundTrip = steppedScale(steppedScale(start, 1), -1);
      expect(roundTrip, `${start}`).toBeCloseTo(start, 9);
    }
  });

  it('ne depasse jamais les bornes du recadrage', () => {
    let scale = 1;
    for (let i = 0; i < 40; i++) scale = steppedScale(scale, 1);
    expect(scale).toBe(MAX_CLIP_SCALE);

    for (let i = 0; i < 40; i++) scale = steppedScale(scale, -1);
    expect(scale).toBe(MIN_CLIP_SCALE);
  });

  it('atteint chaque borne en un nombre raisonnable de pressions', () => {
    /*
      Le pas est un compromis mesure, pas un chiffre choisi au hasard: trop
      grand, le sujet sort du cadre a chaque pression; trop petit, il faut
      s'acharner pour traverser la plage.

      Le nombre attendu est DERIVE des bornes plutot qu'ecrit en dur: releve le
      plafond a 500 % et le compte passe mecaniquement de 7 a 12 pressions, sans
      que le pas ait change. Ce que ce test protege, c'est le confort d'usage —
      une vingtaine de pressions au plus pour traverser la plage.
    */
    const expectedUp = Math.ceil(Math.log(MAX_CLIP_SCALE) / Math.log(CLIP_ZOOM_STEP));
    const expectedDown = Math.ceil(Math.log(1 / MIN_CLIP_SCALE) / Math.log(CLIP_ZOOM_STEP));

    let scale = 1;
    let up = 0;
    while (scale < MAX_CLIP_SCALE && up < 100) {
      scale = steppedScale(scale, 1);
      up += 1;
    }
    expect(up).toBe(expectedUp);
    expect(up).toBeLessThanOrEqual(20);

    scale = 1;
    let down = 0;
    while (scale > MIN_CLIP_SCALE && down < 100) {
      scale = steppedScale(scale, -1);
      down += 1;
    }
    expect(down).toBe(expectedDown);
    expect(down).toBeLessThanOrEqual(20);
  });

  it('repart de 100 % pour une echelle non finie', () => {
    // `NaN * 1,15` reste `NaN` et traverserait `clamp` sans etre attrape: le
    // compositeur dessinerait alors une image de taille indefinie, donc rien.
    expect(steppedScale(Number.NaN, 1)).toBeCloseTo(CLIP_ZOOM_STEP, 9);
    expect(steppedScale(Number.POSITIVE_INFINITY, -1)).toBeCloseTo(1 / CLIP_ZOOM_STEP, 9);
  });

  it('reste dans les bornes meme depuis une valeur aberrante', () => {
    expect(steppedScale(1000, 1)).toBe(MAX_CLIP_SCALE);
    expect(steppedScale(-5, -1)).toBe(MIN_CLIP_SCALE);
  });
});
