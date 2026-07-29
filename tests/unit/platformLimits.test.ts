import { describe, expect, it } from 'vitest';

import { PLATFORM_LIMITS, PLATFORM_PRESETS, type PlatformPresetId } from '@/domain/types';
import { formatDurationLimit } from '@/lib/format';

const IDS = Object.keys(PLATFORM_PRESETS) as PlatformPresetId[];

/**
 * Les durees formatees separent le nombre de son unite par une espace INSECABLE,
 * pour qu'un retour a la ligne ne laisse jamais « 90 » seul en bout de ligne. On
 * la normalise avant de comparer.
 *
 * Le caractere est CONSTRUIT et non ecrit: un NBSP litteral est invisible a la
 * relecture, et ESLint le refuse a juste titre (`no-irregular-whitespace`).
 */
function plain(text: string): string {
  return text.split(String.fromCharCode(160)).join(' ');
}

describe('formatDurationLimit', () => {
  it('reste en secondes sous la minute', () => {
    expect(plain(formatDurationLimit(45, 'en'))).toBe('45 s');
    expect(plain(formatDurationLimit(0, 'en'))).toBe('0 s');
  });

  it('passe en minutes, sans decimale trompeuse', () => {
    /*
      C'est le point qui motive cette fonction plutot que `formatDuration`:
      90 s doit se lire « 1 min 30 s » et non « 1,5 min », qui se comprend mal.
    */
    expect(plain(formatDurationLimit(90, 'en'))).toBe('1 min 30 s');
    expect(plain(formatDurationLimit(600, 'en'))).toBe('10 min');
    expect(plain(formatDurationLimit(60, 'en'))).toBe('1 min');
  });

  it('passe en heures pour les longues limites', () => {
    expect(plain(formatDurationLimit(4 * 3600, 'en'))).toBe('4 h');
    expect(plain(formatDurationLimit(12 * 3600, 'en'))).toBe('12 h');
    expect(plain(formatDurationLimit(3600 + 1800, 'en'))).toBe('1 h 30 min');
  });

  it('n affiche pas les unites nulles', () => {
    // Une limite pile sur l'heure ne doit pas afficher « 2 h 0 min ».
    expect(plain(formatDurationLimit(7200, 'en'))).toBe('2 h');
  });

  it('ne renvoie jamais de duree negative', () => {
    expect(plain(formatDurationLimit(-30, 'en'))).toBe('0 s');
  });
});

describe('PLATFORM_LIMITS', () => {
  it('couvre exactement les destinations proposees', () => {
    // Une destination sans limite afficherait un blanc; une limite orpheline
    // serait du code mort.
    expect(Object.keys(PLATFORM_LIMITS).sort()).toEqual([...IDS].sort());
  });

  it('donne des bornes strictement positives', () => {
    for (const id of IDS) {
      expect(PLATFORM_LIMITS[id].maxDuration, `${id} duree`).toBeGreaterThan(0);
      expect(PLATFORM_LIMITS[id].maxBytes, `${id} taille`).toBeGreaterThan(0);
    }
  });

  it('impose aux formats courts les limites les plus serrees', () => {
    /*
      Verification de coherence: reels et shorts sont bien plus contraints que la
      video classique. Si la relation s'inversait, ce serait le signe d'une valeur
      saisie a l'envers — le genre d'erreur qu'aucun typage ne rattrape.
    */
    expect(PLATFORM_LIMITS.instagramReel.maxDuration).toBeLessThan(
      PLATFORM_LIMITS.youtube.maxDuration,
    );
    expect(PLATFORM_LIMITS.youtubeShorts.maxDuration).toBeLessThan(
      PLATFORM_LIMITS.youtube.maxDuration,
    );
    expect(PLATFORM_LIMITS.facebookReel.maxDuration).toBeLessThan(
      PLATFORM_LIMITS.facebookFeed.maxDuration,
    );
  });

  it('reste lisible une fois formatee, dans les deux langues', () => {
    for (const id of IDS) {
      for (const locale of ['fr', 'en']) {
        const text = formatDurationLimit(PLATFORM_LIMITS[id].maxDuration, locale);
        expect(text, `${id} en ${locale}`).not.toContain('NaN');
        expect(text.length, `${id} en ${locale}`).toBeGreaterThan(0);
      }
    }
  });
});
