/**
 * Tests de l'encodeur QR.
 *
 * L'enjeu: un QR code faux se voit comme un QR code juste. Verifier « il y a
 * des carres noirs » ne prouve rien. Ces tests DECODENT donc la matrice en
 * relisant la norme a l'envers — extraction du format, retrait du masque,
 * relecture du zigzag — puis comparent au texte d'origine.
 *
 * Le decodeur du test est ecrit independamment de l'encodeur: il ne reutilise
 * aucune de ses fonctions internes, sans quoi une erreur symetrique passerait
 * inapercue dans les deux sens.
 */

import { describe, expect, it } from 'vitest';

import { encodeQr, qrPath, type QrMatrix } from '../../src/domain/qrcode';

/** L'adresse reellement affichee par l'application. */
const APP_URL = 'https://app.francotamouls.com/beatapp';

/** Les huit masques, redefinis ici pour ne pas dependre de l'encodeur. */
const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Reconstruit la carte des modules reserves, comme le ferait un decodeur. */
function reservedMap(size: number, version: number): boolean[] {
  const reserved = new Array<boolean>(size * size).fill(false);
  const mark = (x: number, y: number) => {
    if (x >= 0 && x < size && y >= 0 && y < size) reserved[y * size + x] = true;
  };

  for (const [ox, oy] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ] as const) {
    for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) mark(ox + x, oy + y);
  }

  for (let i = 0; i < size; i++) {
    mark(i, 6);
    mark(6, i);
  }

  const centers: readonly number[] = [[], [], [6, 18], [6, 22], [6, 26]][version] ?? [];
  for (const cy of centers) {
    for (const cx of centers) {
      const nearFinder =
        (cx <= 8 && cy <= 8) || (cx <= 8 && cy >= size - 9) || (cx >= size - 9 && cy <= 8);
      if (nearFinder) continue;
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) mark(cx + x, cy + y);
    }
  }

  for (let i = 0; i < 9; i++) {
    mark(i, 8);
    mark(8, i);
  }
  for (let i = 0; i < 8; i++) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }
  return reserved;
}

/** Lit les 15 bits de format et en extrait le numero de masque. */
function readMask(m: QrMatrix): number {
  const at = (x: number, y: number) => m.modules[y * m.size + x]!;
  let bits = 0;
  for (let i = 0; i <= 5; i++) bits |= (at(8, i) ? 1 : 0) << i;
  bits |= (at(8, 7) ? 1 : 0) << 6;
  bits |= (at(8, 8) ? 1 : 0) << 7;
  bits |= (at(7, 8) ? 1 : 0) << 8;
  for (let i = 9; i <= 14; i++) bits |= (at(14 - i, 8) ? 1 : 0) << i;

  const unmasked = bits ^ 0x5412;
  // 3 bits de poids fort des 5 bits utiles = niveau de correction; les 3 bits
  // suivants = le masque.
  return (unmasked >> 10) & 0b111;
}

/**
 * Decode une matrice en chaine, en mode octet.
 *
 * Ne corrige pas les erreurs: inutile ici, la matrice sort intacte de
 * l'encodeur. On relit simplement les mots de donnees.
 */
function decode(m: QrMatrix): string {
  const version = (m.size - 17) / 4;
  const reserved = reservedMap(m.size, version);
  const mask = MASKS[readMask(m)]!;

  // Retrait du masque sur les seuls modules de donnees.
  const plain = m.modules.map((dark, i) => {
    if (reserved[i]) return dark;
    const x = i % m.size;
    const y = Math.floor(i / m.size);
    return mask(x, y) ? !dark : dark;
  });

  // Relecture du zigzag, dans l'ordre exact de l'ecriture.
  const bits: boolean[] = [];
  let upward = true;
  for (let right = m.size - 1; right > 0; right -= 2) {
    const col = right <= 6 ? right - 1 : right;
    for (let step = 0; step < m.size; step++) {
      const y = upward ? m.size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const x = col - dx;
        const i = y * m.size + x;
        if (!reserved[i]) bits.push(plain[i]!);
      }
    }
    upward = !upward;
  }

  const readInt = (offset: number, length: number) => {
    let value = 0;
    for (let i = 0; i < length; i++) value = (value << 1) | (bits[offset + i] ? 1 : 0);
    return value;
  };

  expect(readInt(0, 4)).toBe(0b0100); // mode octet
  const length = readInt(4, 8);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = readInt(12 + i * 8, 8);
  return new TextDecoder().decode(bytes);
}

describe('encodeQr', () => {
  it("restitue l'adresse de l'application apres decodage", () => {
    const matrix = encodeQr(APP_URL);
    expect(decode(matrix)).toBe(APP_URL);
  });

  it('choisit la version 3 pour cette adresse', () => {
    // 37 octets: la version 2 plafonne a 26, la version 3 a 42.
    expect(encodeQr(APP_URL).size).toBe(3 * 4 + 17);
  });

  it('restitue des textes de longueurs variees', () => {
    for (const text of ['a', 'https://x.co', 'A'.repeat(42), 'accents: éàü — ok']) {
      expect(decode(encodeQr(text))).toBe(text);
    }
  });

  it('encode l’UTF-8 sur plusieurs octets', () => {
    // Un caractere accentue pese 2 octets: la capacite se compte en OCTETS et
    // non en caracteres, et confondre les deux deborderait silencieusement.
    const text = 'éééé';
    expect(decode(encodeQr(text))).toBe(text);
  });

  it('pose les trois motifs de detection', () => {
    const m = encodeQr(APP_URL);
    const at = (x: number, y: number) => m.modules[y * m.size + x];
    for (const [ox, oy] of [
      [0, 0],
      [m.size - 7, 0],
      [0, m.size - 7],
    ] as const) {
      expect(at(ox + 0, oy + 0)).toBe(true);
      expect(at(ox + 1, oy + 1)).toBe(false);
      expect(at(ox + 3, oy + 3)).toBe(true); // coeur 3x3
    }
  });

  it('laisse la ligne de synchronisation en alternance stricte', () => {
    const m = encodeQr(APP_URL);
    for (let i = 8; i < m.size - 8; i++) {
      expect(m.modules[6 * m.size + i]).toBe(i % 2 === 0);
    }
  });

  it('refuse un texte trop long plutot que de rendre une matrice fausse', () => {
    // Un QR code illisible ne se signale pas: mieux vaut lever.
    expect(() => encodeQr('x'.repeat(63))).toThrow(/capacite/i);
  });

  it('rend un chemin SVG couvrant exactement les modules sombres', () => {
    const m = encodeQr(APP_URL);
    const dark = m.modules.filter(Boolean).length;
    expect(qrPath(m).match(/M/g)).toHaveLength(dark);
  });
});
