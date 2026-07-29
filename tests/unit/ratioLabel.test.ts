import { describe, expect, it } from 'vitest';

import {
  ASPECT_RATIOS,
  frameOrientation,
  ratioLabel,
  type AspectRatioId,
} from '@/domain/types';

const FORMATS = Object.keys(ASPECT_RATIOS) as AspectRatioId[];

describe('ratioLabel', () => {
  it('nomme exactement chaque format propose', () => {
    // Un format du selecteur ne doit JAMAIS s'afficher avec un « ~ ».
    const expected: Record<AspectRatioId, string> = {
      reel: '9:16',
      square: '1:1',
      portrait: '4:5',
      landscape: '16:9',
      classic: '4:3',
      classicPortrait: '3:4',
    };

    for (const id of FORMATS) {
      const label = ratioLabel(ASPECT_RATIOS[id]);
      expect(label, id).not.toBeNull();
      expect(label!.text, id).toBe(expected[id]);
      expect(label!.approximate, `${id} doit etre exact`).toBe(false);
    }
  });

  it('bascule en approximatif a un pixel pres, sans changer le texte', () => {
    /*
      C'est le coeur du choix de conception: une reduction par PGCD donnerait
      « 1080:1921 », illisible. Le texte doit rester « 9:16 », seul le drapeau
      change.
    */
    const label = ratioLabel({ width: 1080, height: 1921 });
    expect(label).not.toBeNull();
    expect(label!.text).toBe('9:16');
    expect(label!.approximate).toBe(true);
  });

  it('rapproche des dimensions quelconques du ratio connu le plus proche', () => {
    for (const [width, height, text] of [
      [1920, 1082, '16:9'],
      [1234, 987, '5:4'],
      [2560, 1080, '21:9'],
      [1000, 1002, '1:1'],
    ] as const) {
      const label = ratioLabel({ width, height });
      expect(label, `${width}x${height}`).not.toBeNull();
      expect(label!.text, `${width}x${height}`).toBe(text);
      expect(label!.approximate, `${width}x${height}`).toBe(true);
    }
  });

  it('n invente RIEN quand aucun ratio connu ne decrit la forme', () => {
    /*
      Le test qui compte le plus. Sans plafond d'ecart, 240x2560 s'affichait
      « ~ 9:16 » avec 179 % d'erreur: une etiquette qui ment est pire que pas
      d'etiquette du tout.
    */
    expect(ratioLabel({ width: 240, height: 2560 })).toBeNull();
    expect(ratioLabel({ width: 400, height: 2000 })).toBeNull();
  });

  it('est symetrique: inverser les cotes inverse le ratio', () => {
    expect(ratioLabel({ width: 1920, height: 1080 })!.text).toBe('16:9');
    expect(ratioLabel({ width: 1080, height: 1920 })!.text).toBe('9:16');
    expect(ratioLabel({ width: 1440, height: 1080 })!.text).toBe('4:3');
    expect(ratioLabel({ width: 1080, height: 1440 })!.text).toBe('3:4');
  });

  it('ne plante pas sur des dimensions degenerees', () => {
    // Une frame a zero ne doit pas produire `Infinity` ni `NaN` dans un log.
    expect(ratioLabel({ width: 0, height: 1080 })).toBeNull();
    expect(ratioLabel({ width: 1080, height: 0 })).toBeNull();
    expect(ratioLabel({ width: Number.NaN, height: 1080 })).toBeNull();
  });

  it('est independant de l echelle', () => {
    // Seule la FORME compte: doubler les deux cotes ne change pas le ratio.
    expect(ratioLabel({ width: 540, height: 960 })!.text).toBe('9:16');
    expect(ratioLabel({ width: 2160, height: 3840 })!.text).toBe('9:16');
  });
});

describe('frameOrientation', () => {
  it('classe les formats proposes', () => {
    expect(frameOrientation(ASPECT_RATIOS.reel)).toBe('vertical');
    expect(frameOrientation(ASPECT_RATIOS.portrait)).toBe('vertical');
    expect(frameOrientation(ASPECT_RATIOS.classicPortrait)).toBe('vertical');
    expect(frameOrientation(ASPECT_RATIOS.square)).toBe('square');
    expect(frameOrientation(ASPECT_RATIOS.landscape)).toBe('horizontal');
    expect(frameOrientation(ASPECT_RATIOS.classic)).toBe('horizontal');
  });

  it('ne dit « carre » que sur une egalite stricte', () => {
    expect(frameOrientation({ width: 1080, height: 1082 })).toBe('vertical');
    expect(frameOrientation({ width: 1082, height: 1080 })).toBe('horizontal');
  });
});
