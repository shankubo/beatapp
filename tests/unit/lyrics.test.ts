/**
 * Calage des paroles sur le rythme.
 *
 * C'est la seule partie automatisee de la fonction paroles (il n'y a pas de
 * transcription), donc la seule qui puisse se tromper silencieusement: une ligne
 * qui tombe un demi-temps trop tard se voit a l'oeil sur le reel fini.
 */

import { describe, expect, it } from 'vitest';

import {
  activeLyricIndex,
  alignLyricsToBeats,
  lyricOverlays,
  parseLyricLines,
  sungFraction,
} from '@/domain/lyrics';
import type { LyricLine } from '@/domain/types';
import { createLyrics } from '@/domain/project';

/** Grille regulière de `count` temps espaces de `interval`. */
function grid(count: number, interval: number, offset = 0): number[] {
  return Array.from({ length: count }, (_, index) => offset + index * interval);
}

describe('parseLyricLines', () => {
  it('decoupe par retour a la ligne et ignore les lignes vides', () => {
    expect(parseLyricLines('un\n\ndeux\n  trois  \n')).toEqual(['un', 'deux', 'trois']);
  });

  it('renvoie un tableau vide pour une saisie blanche', () => {
    expect(parseLyricLines('   \n\n  ')).toEqual([]);
  });
});

describe('alignLyricsToBeats', () => {
  it('place une ligne tous les `beatsPerLine` temps', () => {
    // 8 temps d'une demi-seconde (120 BPM), 4 temps par ligne => 2 s par ligne.
    const lines = alignLyricsToBeats(['a', 'b'], grid(9, 0.5), {
      beatsPerLine: 4,
      until: 100,
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]!.start).toBeCloseTo(0, 6);
    expect(lines[0]!.duration).toBeCloseTo(2, 6);
    expect(lines[1]!.start).toBeCloseTo(2, 6);
  });

  it('respecte `startAt` en se calant sur le premier temps utilisable', () => {
    const lines = alignLyricsToBeats(['a'], grid(20, 0.5), {
      beatsPerLine: 2,
      startAt: 1.2,
      until: 100,
    });
    // Le premier point de grille >= 1,2 est 1,5.
    expect(lines[0]!.start).toBeCloseTo(1.5, 6);
  });

  it('ne depasse jamais la fin du reel', () => {
    const lines = alignLyricsToBeats(['a', 'b', 'c', 'd'], grid(40, 0.5), {
      beatsPerLine: 4,
      until: 3,
    });

    for (const line of lines) {
      expect(line.start).toBeLessThan(3);
      expect(line.start + line.duration).toBeLessThanOrEqual(3 + 1e-9);
    }
  });

  it('repartit regulierement sans grille rythmique', () => {
    // Sans analyse, mieux vaut un calage approximatif que pas de paroles.
    const lines = alignLyricsToBeats(['a', 'b', 'c'], [], {
      beatsPerLine: 4,
      until: 6,
    });

    expect(lines).toHaveLength(3);
    expect(lines[0]!.start).toBeCloseTo(0, 6);
    // Les lignes ne se chevauchent pas.
    for (let i = 1; i < lines.length; i += 1) {
      expect(lines[i]!.start).toBeGreaterThanOrEqual(
        lines[i - 1]!.start + lines[i - 1]!.duration - 1e-9,
      );
    }
  });

  it('prolonge la derniere ligne au-dela de la grille', () => {
    // Deux lignes de 4 temps, mais seulement 5 temps de grille.
    const lines = alignLyricsToBeats(['a', 'b'], grid(5, 0.5), {
      beatsPerLine: 4,
      until: 100,
    });

    expect(lines).toHaveLength(2);
    // La seconde ligne n'a pas de point de fin: elle est prolongee, pas tronquee.
    expect(lines[1]!.duration).toBeGreaterThan(0);
  });

  it('produit des lignes de duree strictement positive', () => {
    const lines = alignLyricsToBeats(['a', 'b', 'c'], grid(12, 0.5), {
      beatsPerLine: 1,
      until: 100,
    });
    for (const line of lines) {
      expect(line.duration).toBeGreaterThan(0);
    }
  });

  it('donne des identifiants distincts', () => {
    const lines = alignLyricsToBeats(['a', 'b', 'c'], grid(12, 0.5), {
      beatsPerLine: 2,
      until: 100,
    });
    expect(new Set(lines.map((line) => line.id)).size).toBe(3);
  });
});

describe('lyricOverlays', () => {
  it('applique le style et la position communs a toutes les lignes', () => {
    const lyrics = {
      ...createLyrics(),
      lines: alignLyricsToBeats(['a', 'b'], grid(12, 0.5), {
        beatsPerLine: 4,
        until: 100,
      }),
    };

    const overlays = lyricOverlays(lyrics);
    expect(overlays).toHaveLength(2);
    for (const overlay of overlays) {
      expect(overlay.y).toBe(lyrics.y);
      expect(overlay.style).toBe(lyrics.style);
      expect(overlay.maxWidth).toBe(lyrics.maxWidth);
    }
  });

  it('conserve le texte tel quel', () => {
    // Le texte de l'utilisateur n'est jamais transforme: ce n'est pas une cle i18n.
    const lyrics = {
      ...createLyrics(),
      lines: [{ id: 'l1', text: 'Ça va aller 🔥', start: 0, duration: 1 }],
    };
    expect(lyricOverlays(lyrics)[0]!.text).toBe('Ça va aller 🔥');
  });
});

describe('activeLyricIndex', () => {
  const lines = [
    { id: 'a', text: 'a', start: 0, duration: 2 },
    { id: 'b', text: 'b', start: 2, duration: 2 },
  ];

  it('trouve la ligne courante', () => {
    expect(activeLyricIndex(lines, 0)).toBe(0);
    expect(activeLyricIndex(lines, 1.9)).toBe(0);
    expect(activeLyricIndex(lines, 2)).toBe(1);
  });

  it('renvoie -1 hors de toute ligne', () => {
    expect(activeLyricIndex(lines, 10)).toBe(-1);
  });
});

describe('sungFraction', () => {
  /** Ligne de 4 s a partir de t=10, sans mots horodates. */
  const plain: LyricLine = {
    id: 'l1',
    text: 'aaaa bbbb',
    start: 10,
    duration: 4,
  };

  it('vaut 0 avant la ligne et 1 apres', () => {
    expect(sungFraction(plain, 9)).toBe(0);
    expect(sungFraction(plain, 10)).toBe(0);
    expect(sungFraction(plain, 14)).toBe(1);
    expect(sungFraction(plain, 20)).toBe(1);
  });

  it('balaye lineairement sans mots horodates', () => {
    // Faute de mesure, un balayage regulier vaut mieux que pas de karaoke.
    expect(sungFraction(plain, 11)).toBeCloseTo(0.25, 3);
    expect(sungFraction(plain, 12)).toBeCloseTo(0.5, 3);
    expect(sungFraction(plain, 13)).toBeCloseTo(0.75, 3);
  });

  /**
   * Deux mots de longueurs INEGALES: 2 et 6 caracteres, une seconde chacun.
   * C'est le cas qui distingue une fraction en caracteres d'une fraction en mots.
   */
  const timed: LyricLine = {
    id: 'l2',
    text: 'ab cdefgh',
    start: 0,
    duration: 2,
    words: [
      { text: 'ab', start: 0, end: 1 },
      { text: 'cdefgh', start: 1, end: 2 },
    ],
  };

  it('compte en CARACTERES et non en mots', () => {
    // Apres le premier mot (2 des 8 caracteres), on est a 25 % et non a 50 %:
    // le rendu mesure une largeur de texte, donc un mot long doit occuper
    // proportionnellement plus de surlignage.
    expect(sungFraction(timed, 1)).toBeCloseTo(2 / 8, 3);
  });

  it('interpole A L INTERIEUR du mot courant', () => {
    // Sans cette interpolation, le front sauterait par blocs et paraitrait
    // saccade. A mi-parcours du second mot: 2 + 3 des 8 caracteres.
    expect(sungFraction(timed, 1.5)).toBeCloseTo(5 / 8, 3);
    // Au quart du premier mot.
    expect(sungFraction(timed, 0.25)).toBeCloseTo(0.5 / 8, 3);
  });

  it('progresse de facon monotone', () => {
    // Propriete la plus importante: le surlignage ne doit JAMAIS reculer.
    let previous = -1;
    for (let time = -0.5; time <= 2.5; time += 0.05) {
      const value = sungFraction(timed, time);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('reste borne a [0, 1]', () => {
    for (let time = -1; time <= 3; time += 0.1) {
      const value = sungFraction(timed, time);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('tolere un mot de duree nulle', () => {
    // Arrondi du modele: `start === end`. Sans garde-fou, division par zero.
    const degenerate: LyricLine = {
      id: 'l3',
      text: 'ab cd',
      start: 0,
      duration: 2,
      words: [
        { text: 'ab', start: 0, end: 0 },
        { text: 'cd', start: 0, end: 2 },
      ],
    };
    expect(Number.isFinite(sungFraction(degenerate, 0.5))).toBe(true);
  });

  it('tolere une liste de mots vide', () => {
    const empty: LyricLine = { ...plain, words: [] };
    // On retombe sur le balayage lineaire.
    expect(sungFraction(empty, 12)).toBeCloseTo(0.5, 3);
  });

  it('ignore un silence entre deux mots', () => {
    // Whisper laisse des trous. Pendant le silence, le front doit STAGNER au
    // lieu d'avancer: rien n'est chante.
    const gapped: LyricLine = {
      id: 'l4',
      text: 'ab cd',
      start: 0,
      duration: 4,
      words: [
        { text: 'ab', start: 0, end: 1 },
        { text: 'cd', start: 3, end: 4 },
      ],
    };
    const atGapStart = sungFraction(gapped, 1.1);
    const atGapEnd = sungFraction(gapped, 2.9);
    expect(atGapEnd).toBeCloseTo(atGapStart, 5);
  });
});
