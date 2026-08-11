import { describe, expect, it } from 'vitest';

import {
  getKenBurnsPreset,
  KEN_BURNS_KEYS,
  KEN_BURNS_PRESETS,
} from '@/domain/project';
import type { KenBurns } from '@/domain/types';

describe('Presets Ken Burns', () => {
  it('associe chaque preset a ses proprietes', () => {
    for (const key of KEN_BURNS_KEYS) {
      const preset = KEN_BURNS_PRESETS[key];
      expect(getKenBurnsPreset(preset)).toBe(key);
    }
  });

  it('retombe sur zoomIn pour une config absente ou non reconnue', () => {
    expect(getKenBurnsPreset(undefined)).toBe('zoomIn');

    const weirdConfig: KenBurns = { toScale: 42, toX: 0.123, toY: 0.456 };
    expect(getKenBurnsPreset(weirdConfig)).toBe('zoomIn');
  });

  it('tolere de petites erreurs de flottants', () => {
    const approximateZoomIn: KenBurns = { toScale: 1.12001, toX: 0, toY: 0.00002 };
    expect(getKenBurnsPreset(approximateZoomIn)).toBe('zoomIn');
  });
});
