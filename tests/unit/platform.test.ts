import { describe, expect, it } from 'vitest';

import { detectPlatform } from '../../src/features/install/platform';

/** Agents utilisateur reels, releves sur les navigateurs vises. */
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_MODERNE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

describe('detectPlatform', () => {
  it('reconnait un iPhone', () => {
    expect(detectPlatform(IPHONE, 5)).toBe('ios');
  });

  it('reconnait un Android', () => {
    expect(detectPlatform(ANDROID, 5)).toBe('android');
  });

  it('reconnait un ordinateur', () => {
    expect(detectPlatform(WINDOWS, 0)).toBe('desktop');
    expect(detectPlatform(MAC, 0)).toBe('desktop');
  });

  it('range un iPad moderne en iOS malgre son agent « Macintosh »', () => {
    // Depuis iPadOS 13, seul le tactile distingue un iPad d'un Mac. Sans ce
    // rattrapage, l'iPad recevrait une procedure qui n'existe pas chez lui.
    expect(detectPlatform(IPAD_MODERNE, 5)).toBe('ios');
  });

  it('laisse un Mac tactile-zero en ordinateur', () => {
    // Meme chaine que l'iPad: c'est bien le tactile qui tranche.
    expect(detectPlatform(IPAD_MODERNE, 0)).toBe('desktop');
  });
});
