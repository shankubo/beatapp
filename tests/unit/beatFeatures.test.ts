import { describe, expect, it } from 'vitest';

import { computeOnsetFunction, type SpectralFrames } from '@/audio/beatDetection';
import { detectDynamics } from '@/audio/features/dynamics';
import { detectSections } from '@/audio/features/sections';
import { detectTimbre } from '@/audio/features/timbre';

const SR = 44_100;

/** Spectre d'un signal, tel que les detecteurs le consomment. */
function spectrumOf(samples: Float32Array): SpectralFrames {
  const analysis = computeOnsetFunction(samples, SR, { keepSpectrum: true });
  const spectrum = analysis.spectrum;
  if (!spectrum) throw new Error('spectre absent');
  return spectrum;
}

/** Sinusoide d'amplitude et de frequence constantes. */
function tone(frequency: number, seconds: number, amplitude = 0.5): Float32Array {
  const length = Math.floor(seconds * SR);
  const s = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    s[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SR);
  }
  return s;
}

function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe('detectDynamics', () => {
  it('trouve la rupture entre fort et faible', () => {
    // Verite construite: le changement tombe a 6 s.
    const samples = concat(tone(220, 6, 0.6), tone(220, 6, 0.05));
    const result = detectDynamics(spectrumOf(samples));

    expect(result.times.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    // Au moins une rupture pres de la jonction, a une seconde pres.
    const closest = Math.min(...result.times.map((t) => Math.abs(t - 6)));
    expect(closest).toBeLessThan(1);
  });

  it('ne trouve RIEN sur une energie constante', () => {
    /**
     * Le test le plus important de ce fichier.
     *
     * Le depot a deja appris cette lecon avec `MIN_ODF_SHARPNESS`: sans critere de
     * platitude, la fuite spectrale d'un son tenu faisait detecter un rythme
     * inexistant. Un detecteur doit savoir dire « je ne sais pas », sinon il
     * inventera des ruptures dans du bruit numerique.
     */
    const result = detectDynamics(spectrumOf(tone(220, 12, 0.5)));
    expect(result.times).toEqual([]);
    expect(result.confidence).toBe(0);
  });

  it('ne trouve rien sur du silence', () => {
    const result = detectDynamics(spectrumOf(new Float32Array(SR * 8)));
    expect(result.times).toEqual([]);
    expect(result.confidence).toBe(0);
  });
});

describe('detectTimbre', () => {
  it('trouve un changement de couleur a VOLUME CONSTANT', () => {
    /**
     * C'est la raison d'etre de ce critere, et le piege du test.
     *
     * Les deux moities ont la meme amplitude: un detecteur qui suivrait l'energie
     * ne verrait rien. Seule la couleur change (300 Hz puis 3000 Hz), et c'est
     * exactement le genre d'instant — entree d'un instrument, ouverture d'un
     * filtre — qu'aucune grille rythmique ne peut trouver.
     */
    const samples = concat(tone(300, 6, 0.5), tone(3000, 6, 0.5));
    const result = detectTimbre(spectrumOf(samples));

    expect(result.times.length).toBeGreaterThan(0);
    const closest = Math.min(...result.times.map((t) => Math.abs(t - 6)));
    expect(closest).toBeLessThan(1);
  });

  it('ne trouve RIEN sur un timbre stable', () => {
    const result = detectTimbre(spectrumOf(tone(440, 12, 0.5)));
    expect(result.times).toEqual([]);
    expect(result.confidence).toBe(0);
  });
});

describe('detectSections', () => {
  it('trouve la frontiere entre deux contenus harmoniques', () => {
    // Deux "sections" de 10 s: un accord grave, puis un accord aigu different.
    const chordA = concat(
      ...[0].map(() => {
        const a = tone(220, 10, 0.3);
        const b = tone(277, 10, 0.3);
        const c = tone(330, 10, 0.3);
        const out = new Float32Array(a.length);
        for (let i = 0; i < a.length; i += 1) out[i] = a[i]! + b[i]! + c[i]!;
        return out;
      }),
    );
    const chordB = concat(
      ...[0].map(() => {
        const a = tone(392, 10, 0.3);
        const b = tone(494, 10, 0.3);
        const c = tone(587, 10, 0.3);
        const out = new Float32Array(a.length);
        for (let i = 0; i < a.length; i += 1) out[i] = a[i]! + b[i]! + c[i]!;
        return out;
      }),
    );

    const result = detectSections(spectrumOf(concat(chordA, chordB)));
    expect(result.times.length).toBeGreaterThan(0);
    // La frontiere construite est a 10 s. La granularite etant de 2 s et le noyau
    // large, on accepte 3 s d'ecart.
    const closest = Math.min(...result.times.map((t) => Math.abs(t - 10)));
    expect(closest).toBeLessThan(3);
  });

  it('ne trouve RIEN sur un contenu homogene', () => {
    // Un seul accord tenu: aucune frontiere n'existe, il ne faut rien inventer.
    const result = detectSections(spectrumOf(tone(220, 30, 0.4)));
    expect(result.times).toEqual([]);
  });
});
