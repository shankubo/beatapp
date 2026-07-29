import { describe, expect, it } from 'vitest';

import {
  MAX_CLIP_OFFSET,
  clampTransform,
  offsetLimitFor,
} from '@/domain/project';

const REEL = { width: 1080, height: 1920 };

/** Decalage qu'il FAUT pour amener le bord de l'image sur le bord du cadre. */
function neededOffset(
  source: { width: number; height: number },
  frame: { width: number; height: number },
  scale: number,
) {
  const ratio = Math.max(frame.width / source.width, frame.height / source.height);
  return {
    x: (source.width * ratio * scale - frame.width) / 2 / frame.width,
    y: (source.height * ratio * scale - frame.height) / 2 / frame.height,
  };
}

describe('offsetLimitFor', () => {
  it('permet d atteindre le bord de l image a fort zoom', () => {
    /*
      Le defaut corrige. Avec le plafond fixe de 0,4, une photo 3:4 zoomee a
      500 % n'exposait que 14 % de sa surface: les bords etaient inaccessibles.
      On verifie que la borne couvre desormais le debordement reel.
    */
    const source = { width: 3024, height: 4032 };
    for (const scale of [1.5, 2, 3, 5]) {
      const limit = offsetLimitFor(source, REEL, 'cover', scale);
      const needed = neededOffset(source, REEL, scale);
      expect(limit.x, `x a ${scale}x`).toBeGreaterThanOrEqual(needed.x - 1e-9);
      expect(limit.y, `y a ${scale}x`).toBeGreaterThanOrEqual(needed.y - 1e-9);
    }
  });

  it('couvre aussi un paysage dans un cadre vertical', () => {
    /*
      Ce cas ne dependait PAS du zoom: une photo 3:2 posee en `cover` dans un
      reel 9:16 est dessinee bien plus large que le cadre, et ses bords gauche
      et droit etaient deja hors d'atteinte a 100 %.
    */
    const source = { width: 6000, height: 4000 };
    const limit = offsetLimitFor(source, REEL, 'cover', 1);
    const needed = neededOffset(source, REEL, 1);
    expect(limit.x).toBeGreaterThanOrEqual(needed.x - 1e-9);
    expect(needed.x).toBeGreaterThan(MAX_CLIP_OFFSET); // l'ancien plafond bloquait
  });

  it('ne descend jamais sous le plafond fixe', () => {
    // En `contain`, ou l'image ne deborde pas, decaler volontairement pour
    // composer avec le fond reste legitime: on garde l'ancien jeu.
    const limit = offsetLimitFor({ width: 1080, height: 1920 }, REEL, 'contain', 1);
    expect(limit.x).toBe(MAX_CLIP_OFFSET);
    expect(limit.y).toBe(MAX_CLIP_OFFSET);
  });

  it('retombe sur le plafond fixe sans dimensions connues', () => {
    // Media non sonde: mieux vaut brider que laisser filer un plan hors cadre.
    const limit = offsetLimitFor(undefined, REEL, 'cover', 5);
    expect(limit).toEqual({ x: MAX_CLIP_OFFSET, y: MAX_CLIP_OFFSET });
  });

  it('ignore une entree aberrante plutot que de propager NaN', () => {
    for (const bad of [
      { width: 0, height: 100 },
      { width: 100, height: -1 },
      { width: Number.NaN, height: 100 },
    ]) {
      const limit = offsetLimitFor(bad, REEL, 'cover', 2);
      expect(Number.isFinite(limit.x), `${bad.width}x${bad.height}`).toBe(true);
      expect(Number.isFinite(limit.y), `${bad.width}x${bad.height}`).toBe(true);
    }
    expect(offsetLimitFor({ width: 100, height: 100 }, REEL, 'cover', Number.NaN)).toEqual({
      x: MAX_CLIP_OFFSET,
      y: MAX_CLIP_OFFSET,
    });
  });
});

describe('clampTransform avec contexte', () => {
  const source = { width: 3024, height: 4032 };
  const context = { source, frame: REEL, fit: 'cover' as const };

  it('laisse passer un decalage que le zoom rend legitime', () => {
    // A 3x, l'image deborde largement: un decalage de 0,8 est atteignable et ne
    // doit plus etre rabote a 0,4.
    const out = clampTransform({ scale: 3, x: 0.8, y: 0.8, rotation: 0 }, context);
    expect(out.x).toBeCloseTo(0.8, 6);
    expect(out.y).toBeCloseTo(0.8, 6);
  });

  it('ramene le decalage dans les bornes quand on dezoome', () => {
    /*
      Le piege que ce bornage evite: un decalage pose a fort zoom devient hors
      limites une fois l'echelle revenue a 1, et l'image partirait hors cadre.
    */
    const out = clampTransform({ scale: 1, x: 0.8, y: 0.8, rotation: 0 }, context);
    const limit = offsetLimitFor(source, REEL, 'cover', 1);
    expect(out.x).toBeLessThanOrEqual(limit.x + 1e-9);
    expect(out.y).toBeLessThanOrEqual(limit.y + 1e-9);
    expect(out.x).toBeLessThan(0.8);
  });

  it('borne le decalage sur l echelle DEJA bornee', () => {
    /*
      Une echelle aberrante (99) est ramenee a 5. Le decalage doit etre borne
      sur 5 et non sur 99, sinon un zoom impossible autoriserait un deplacement
      enorme et le plan quitterait le cadre.
    */
    const out = clampTransform({ scale: 99, x: 50, y: 50, rotation: 0 }, context);
    const limit = offsetLimitFor(source, REEL, 'cover', out.scale);
    expect(out.x).toBeCloseTo(limit.x, 6);
    expect(out.y).toBeCloseTo(limit.y, 6);
  });

  it('conserve le comportement d origine sans contexte', () => {
    // La signature reste retrocompatible: les appels existants ne changent pas.
    const out = clampTransform({ scale: 3, x: 9, y: -9, rotation: 0 });
    expect(out.x).toBe(MAX_CLIP_OFFSET);
    expect(out.y).toBe(-MAX_CLIP_OFFSET);
  });
});
