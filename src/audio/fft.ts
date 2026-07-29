/**
 * FFT radix-2 iterative, sans dependance.
 *
 * Ecrite a la main plutot qu'importee: c'est une soixantaine de lignes, et cela
 * evite d'ajouter une dependance a une PWA ou chaque kilo-octet compte. La
 * fenetre et la table de bit-reversal sont precalculees une fois pour toutes.
 */

export class Fft {
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private readonly reverseTable: Uint32Array;

  constructor(readonly size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`La taille de FFT doit etre une puissance de 2, recu ${size}`);
    }

    const half = size >> 1;
    this.cosTable = new Float32Array(half);
    this.sinTable = new Float32Array(half);
    for (let i = 0; i < half; i += 1) {
      this.cosTable[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((-2 * Math.PI * i) / size);
    }

    // Table de permutation par inversion de bits.
    this.reverseTable = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i += 1) {
      let reversed = 0;
      for (let bit = 0; bit < bits; bit += 1) {
        reversed = (reversed << 1) | ((i >>> bit) & 1);
      }
      this.reverseTable[i] = reversed;
    }
  }

  /**
   * Transforme en place. `real` et `imag` doivent faire `size` echantillons.
   * A l'issue, ils contiennent les parties reelle et imaginaire du spectre.
   */
  transform(real: Float32Array, imag: Float32Array): void {
    const n = this.size;

    // Permutation initiale.
    for (let i = 0; i < n; i += 1) {
      const j = this.reverseTable[i]!;
      if (j > i) {
        const tempReal = real[i]!;
        real[i] = real[j]!;
        real[j] = tempReal;
        const tempImag = imag[i]!;
        imag[i] = imag[j]!;
        imag[j] = tempImag;
      }
    }

    // Papillons de Cooley-Tukey.
    for (let span = 2; span <= n; span <<= 1) {
      const half = span >> 1;
      const step = n / span;
      for (let start = 0; start < n; start += span) {
        for (let offset = 0; offset < half; offset += 1) {
          const evenIndex = start + offset;
          const oddIndex = evenIndex + half;
          const twiddleIndex = offset * step;
          const cos = this.cosTable[twiddleIndex]!;
          const sin = this.sinTable[twiddleIndex]!;

          const oddReal = real[oddIndex]! * cos - imag[oddIndex]! * sin;
          const oddImag = real[oddIndex]! * sin + imag[oddIndex]! * cos;

          real[oddIndex] = real[evenIndex]! - oddReal;
          imag[oddIndex] = imag[evenIndex]! - oddImag;
          real[evenIndex] = real[evenIndex]! + oddReal;
          imag[evenIndex] = imag[evenIndex]! + oddImag;
        }
      }
    }
  }
}

/** Fenetre de Hann: reduit les fuites spectrales entre trames. */
export function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return window;
}
