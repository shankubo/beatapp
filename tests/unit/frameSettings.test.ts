import { describe, expect, it } from 'vitest';

import {
  ASPECT_RATIOS,
  MAX_FRAME_SIDE,
  MIN_FRAME_SIDE,
  PLATFORM_PRESETS,
  clampFrameSide,
  type PlatformPresetId,
} from '@/domain/types';

describe('clampFrameSide', () => {
  it('force un nombre pair', () => {
    // H.264 en 4:2:0 echoue sur un cote impair, et l'echec surviendrait apres
    // plusieurs secondes d'encodage.
    for (const value of [721, 1081, 999, 1351]) {
      expect(clampFrameSide(value) % 2, `${value}`).toBe(0);
    }
  });

  it('borne dans les limites annoncees', () => {
    expect(clampFrameSide(10)).toBe(MIN_FRAME_SIDE);
    expect(clampFrameSide(99_999)).toBe(MAX_FRAME_SIDE);
  });

  it('retombe sur le plancher pour TOUTE saisie non finie', () => {
    /*
      Un champ vide donne `Number('') === 0`, et `Number('abc')` donne `NaN`.
      Laisser passer un `NaN` jusqu'au canvas effacerait l'image — c'est la lecon
      de la migration v1 -> v2, ou un `intensity` absent produisait le meme effet.

      Regle UNIQUE et deliberee: non fini => plancher, y compris `+Infinity`. On
      pourrait le faire retomber sur le plafond, mais deviner une intention a
      partir du signe d'une valeur qui n'est de toute facon pas saisissable
      compliquerait la fonction sans rendre l'interface meilleure. Une seule
      regle se verifie d'un coup d'oeil.
    */
    expect(clampFrameSide(Number.NaN)).toBe(MIN_FRAME_SIDE);
    expect(clampFrameSide(Number.POSITIVE_INFINITY)).toBe(MIN_FRAME_SIDE);
    expect(clampFrameSide(Number.NEGATIVE_INFINITY)).toBe(MIN_FRAME_SIDE);
  });

  it('laisse intactes les valeurs deja valides', () => {
    for (const value of [1080, 1920, 1350, 720]) {
      expect(clampFrameSide(value)).toBe(value);
    }
  });

  it('est idempotent', () => {
    // Reappliquer la fonction sur son resultat ne doit rien changer, sinon un
    // aller-retour dans l'interface deriverait a chaque passage.
    for (const value of [1081, 33, 5000, 719]) {
      const once = clampFrameSide(value);
      expect(clampFrameSide(once)).toBe(once);
    }
  });
});

describe('PLATFORM_PRESETS', () => {
  const ids = Object.keys(PLATFORM_PRESETS) as PlatformPresetId[];

  it('pointe vers un format connu', () => {
    for (const id of ids) {
      expect(ASPECT_RATIOS[PLATFORM_PRESETS[id]], id).toBeDefined();
    }
  });

  it('donne du 9:16 a toutes les destinations verticales', () => {
    // Reels, Shorts et TikTok partagent le meme format: c'est ce qui rend le
    // raccourci utile plutot que decoratif.
    for (const id of ['instagramReel', 'tiktok', 'youtubeShorts', 'facebookReel'] as const) {
      const size = ASPECT_RATIOS[PLATFORM_PRESETS[id]];
      expect(size.width / size.height, id).toBeCloseTo(9 / 16, 2);
    }
  });

  it('donne du 16:9 a YouTube paysage', () => {
    const size = ASPECT_RATIOS[PLATFORM_PRESETS.youtube];
    expect(size.width / size.height).toBeCloseTo(16 / 9, 2);
  });

  it('n expose que des dimensions acceptees par clampFrameSide', () => {
    // Les raccourcis ne doivent jamais produire ce que la saisie libre refuserait.
    for (const id of ids) {
      const size = ASPECT_RATIOS[PLATFORM_PRESETS[id]];
      expect(clampFrameSide(size.width), `${id} largeur`).toBe(size.width);
      expect(clampFrameSide(size.height), `${id} hauteur`).toBe(size.height);
    }
  });
});
