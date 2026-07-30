/**
 * Encodeur QR minimal, en mode octet, correction M.
 *
 * Module PUR: aucune dependance, aucun DOM. Il rend une matrice de booleens que
 * l'appelant dessine comme il veut (SVG a l'ecran, canvas a l'export).
 *
 * POURQUOI PAS UNE BIBLIOTHEQUE — l'application affiche UNE adresse, courte et
 * connue a la compilation. Les encodeurs du registre embarquent le mode
 * kanji, l'ECI, le micro-QR et les huit masques pour un besoin qui tient en
 * version 3. La CSP du projet interdit par ailleurs tout script tiers
 * (`script-src 'self'`), donc un CDN n'etait de toute facon pas une option.
 *
 * Portee volontairement bornee: versions 1 a 4, correction M, mode octet. Au
 * dela, `encodeQr` leve plutot que de rendre une matrice fausse — un QR code
 * illisible est pire qu'une absence de QR code, parce que rien ne le signale.
 */

/** Correction d'erreur retenue: ~15 % de degats tolerés. */
const EC_LEVEL_M = 0;

/**
 * Nombre de mots de donnees et de correction, par version, au niveau M.
 *
 * Limite a 4 versions: au dela il faut gerer plusieurs BLOCS de correction, ce
 * que ce module ne fait pas. `capacity` est la limite en octets du mode octet.
 */
const VERSIONS = [
  { version: 1, totalWords: 26, dataWords: 16, capacity: 14 },
  { version: 2, totalWords: 44, dataWords: 28, capacity: 26 },
  { version: 3, totalWords: 70, dataWords: 44, capacity: 42 },
  { version: 4, totalWords: 100, dataWords: 64, capacity: 62 },
] as const;

/** Position des motifs d'alignement, par version. Vide en version 1. */
const ALIGNMENT_CENTERS: readonly (readonly number[])[] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
];

// --- Arithmetique du corps de Galois GF(256), pour les codes Reed-Solomon.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    // Polynome generateur 0x11d, celui que la norme impose.
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

/** Polynome generateur de degre `degree`, pour Reed-Solomon. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] ?? 0) ^ gfMul(poly[j]!, 1);
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(poly[j]!, GF_EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

/** Mots de correction d'erreur pour `data`. */
function reedSolomon(data: readonly number[], ecWords: number): number[] {
  const gen = generatorPoly(ecWords);
  const rest = new Array<number>(ecWords).fill(0);

  for (const byte of data) {
    const factor = byte ^ rest[0]!;
    rest.shift();
    rest.push(0);
    for (let i = 0; i < ecWords; i++) {
      rest[i] = rest[i]! ^ gfMul(gen[i + 1]!, factor);
    }
  }
  return rest;
}

// --- Informations de format (niveau de correction + masque).

/**
 * Mot de format, 15 bits: 5 bits utiles proteges par un code BCH, puis masques.
 *
 * Le XOR final par 0x5412 est impose par la norme: sans lui, un format tout a
 * zero produirait une zone uniforme que le decodeur ne saurait pas caler.
 */
function formatBits(mask: number): number {
  const data = (EC_LEVEL_M << 3) | mask;
  let value = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((value >> i) & 1) value ^= 0x537 << (i - 10);
  }
  return ((data << 10) | value) ^ 0x5412;
}

// --- Construction de la matrice.

/** Un module reserve (motif fixe) ne doit jamais recevoir de donnee ni de masque. */
interface Grid {
  size: number;
  modules: boolean[];
  reserved: boolean[];
}

function createGrid(size: number): Grid {
  return {
    size,
    modules: new Array<boolean>(size * size).fill(false),
    reserved: new Array<boolean>(size * size).fill(false),
  };
}

function setModule(grid: Grid, x: number, y: number, dark: boolean, reserve = true): void {
  const i = y * grid.size + x;
  grid.modules[i] = dark;
  if (reserve) grid.reserved[i] = true;
}

/** Motif de detection 7x7 et sa separation, a un coin. */
function placeFinder(grid: Grid, ox: number, oy: number): void {
  for (let y = -1; y <= 7; y++) {
    for (let x = -1; x <= 7; x++) {
      const px = ox + x;
      const py = oy + y;
      if (px < 0 || px >= grid.size || py < 0 || py >= grid.size) continue;
      const inRing = x >= 0 && x <= 6 && (y === 0 || y === 6);
      const inSide = y >= 0 && y <= 6 && (x === 0 || x === 6);
      const inCore = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      setModule(grid, px, py, inRing || inSide || inCore);
    }
  }
}

/** Motif d'alignement 5x5, centre sur (cx, cy). */
function placeAlignment(grid: Grid, cx: number, cy: number): void {
  for (let y = -2; y <= 2; y++) {
    for (let x = -2; x <= 2; x++) {
      const ring = Math.max(Math.abs(x), Math.abs(y));
      setModule(grid, cx + x, cy + y, ring !== 1);
    }
  }
}

function placePatterns(grid: Grid, version: number): void {
  const last = grid.size - 7;
  placeFinder(grid, 0, 0);
  placeFinder(grid, last, 0);
  placeFinder(grid, 0, last);

  // Lignes de synchronisation: alternance stricte, elles donnent l'echelle.
  for (let i = 8; i < grid.size - 8; i++) {
    const dark = i % 2 === 0;
    setModule(grid, i, 6, dark);
    setModule(grid, 6, i, dark);
  }

  const centers = ALIGNMENT_CENTERS[version] ?? [];
  for (const cy of centers) {
    for (const cx of centers) {
      // Les coins sont deja occupes par les motifs de detection.
      const nearFinder =
        (cx <= 8 && cy <= 8) || (cx <= 8 && cy >= grid.size - 9) || (cx >= grid.size - 9 && cy <= 8);
      if (!nearFinder) placeAlignment(grid, cx, cy);
    }
  }

  // Zones reservees aux informations de format, remplies plus tard.
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      setModule(grid, i, 8, false);
      setModule(grid, 8, i, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setModule(grid, grid.size - 1 - i, 8, false);
    setModule(grid, 8, grid.size - 1 - i, false);
  }
  // Module toujours sombre, impose par la norme.
  setModule(grid, 8, grid.size - 8, true);
}

/** Les huit masques normalises, indexes par leur numero. */
const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Ecrit les bits de donnees en zigzag, de bas a droite vers le haut. */
function placeData(grid: Grid, bits: readonly boolean[]): void {
  let index = 0;
  let upward = true;

  for (let right = grid.size - 1; right > 0; right -= 2) {
    // La colonne 6 est celle de synchronisation: on la saute entierement.
    const col = right <= 6 ? right - 1 : right;
    for (let step = 0; step < grid.size; step++) {
      const y = upward ? grid.size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const x = col - dx;
        const i = y * grid.size + x;
        if (grid.reserved[i]) continue;
        grid.modules[i] = bits[index++] ?? false;
      }
    }
    upward = !upward;
  }
}

/** Penalites de la norme: elles departagent les huit masques. */
function penalty(grid: Grid): number {
  const { size, modules } = grid;
  const at = (x: number, y: number) => modules[y * size + x]!;
  let score = 0;

  // Regle 1: series de 5 modules ou plus de meme couleur.
  for (let i = 0; i < size; i++) {
    let runRow = 1;
    let runCol = 1;
    for (let j = 1; j < size; j++) {
      runRow = at(j, i) === at(j - 1, i) ? runRow + 1 : 1;
      if (runRow === 5) score += 3;
      else if (runRow > 5) score += 1;

      runCol = at(i, j) === at(i, j - 1) ? runCol + 1 : 1;
      if (runCol === 5) score += 3;
      else if (runCol > 5) score += 1;
    }
  }

  // Regle 2: blocs 2x2 uniformes.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = at(x, y);
      if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) score += 3;
    }
  }

  // Regle 3: motif 1:1:3:1:1 imitant un motif de detection.
  const PATTERN = [true, false, true, true, true, false, true, false, false, false, false];
  const REVERSED = [...PATTERN].reverse();
  const matches = (get: (k: number) => boolean, start: number, pat: boolean[]) =>
    pat.every((want, k) => get(start + k) === want);

  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= size - PATTERN.length; j++) {
      if (matches((k) => at(k, i), j, PATTERN) || matches((k) => at(k, i), j, REVERSED)) score += 40;
      if (matches((k) => at(i, k), j, PATTERN) || matches((k) => at(i, k), j, REVERSED)) score += 40;
    }
  }

  // Regle 4: desequilibre global entre clair et sombre.
  const dark = modules.reduce((n, m) => n + (m ? 1 : 0), 0);
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

/** Matrice carree de modules: `true` = sombre. */
export interface QrMatrix {
  /** Cote en modules, marge NON comprise. */
  size: number;
  /** `size * size` booleens, en lecture ligne par ligne. */
  modules: readonly boolean[];
}

/**
 * Encode `text` en une matrice QR, mode octet, correction M.
 *
 * Leve si le texte depasse la version 4 — voir l'en-tete du module: mieux vaut
 * une erreur au developpement qu'un QR code faux en production.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = [...new TextEncoder().encode(text)];

  const spec = VERSIONS.find((v) => bytes.length <= v.capacity);
  if (!spec) {
    const max = VERSIONS[VERSIONS.length - 1]!;
    throw new Error(
      `QR: ${bytes.length} octets depassent la capacite de ${max.capacity} (version ${max.version}, correction M).`,
    );
  }

  // --- Flux de bits: mode (4 bits), longueur (8 bits), donnees, terminateur.
  const bits: boolean[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push(((value >> i) & 1) === 1);
  };

  push(0b0100, 4);
  push(bytes.length, 8);
  for (const byte of bytes) push(byte, 8);

  const capacityBits = spec.dataWords * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(false);
  while (bits.length % 8 !== 0) bits.push(false);

  // Remplissage normalise, en alternant 0xEC et 0x11.
  const PADS = [0xec, 0x11];
  for (let i = 0; bits.length < capacityBits; i++) push(PADS[i % 2]!, 8);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ? 1 : 0);
    data.push(byte);
  }

  const ec = reedSolomon(data, spec.totalWords - spec.dataWords);
  const finalBits: boolean[] = [];
  for (const byte of [...data, ...ec]) {
    for (let i = 7; i >= 0; i--) finalBits.push(((byte >> i) & 1) === 1);
  }

  // --- Matrice: motifs fixes, donnees, puis choix du masque.
  const size = spec.version * 4 + 17;
  let best: Grid | null = null;
  let bestScore = Infinity;
  let bestMask = 0;

  for (let mask = 0; mask < 8; mask++) {
    const grid = createGrid(size);
    placePatterns(grid, spec.version);
    placeData(grid, finalBits);

    const apply = MASKS[mask]!;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (!grid.reserved[i] && apply(x, y)) grid.modules[i] = !grid.modules[i];
      }
    }

    writeFormat(grid, mask);

    const score = penalty(grid);
    if (score < bestScore) {
      bestScore = score;
      best = grid;
      bestMask = mask;
    }
  }

  const grid = best!;
  writeFormat(grid, bestMask);

  return { size, modules: grid.modules };
}

/** Ecrit les 15 bits de format, en double exemplaire comme l'exige la norme. */
function writeFormat(grid: Grid, mask: number): void {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >> i) & 1) === 1;
  const { size } = grid;

  for (let i = 0; i <= 5; i++) setModule(grid, 8, i, bit(i));
  setModule(grid, 8, 7, bit(6));
  setModule(grid, 8, 8, bit(7));
  setModule(grid, 7, 8, bit(8));
  for (let i = 9; i <= 14; i++) setModule(grid, 14 - i, 8, bit(i));

  for (let i = 0; i <= 7; i++) setModule(grid, size - 1 - i, 8, bit(i));
  for (let i = 8; i <= 14; i++) setModule(grid, 8, size - 15 + i, bit(i));

  setModule(grid, 8, size - 8, true);
}

/**
 * Rend la matrice en chemin SVG (`d`), un carre par module sombre.
 *
 * Un seul chemin plutot que N rectangles: le DOM reste leger et le rendu ne
 * laisse pas apparaitre de liseres clairs entre modules voisins.
 */
export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.modules[y * matrix.size + x]) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return parts.join('');
}
