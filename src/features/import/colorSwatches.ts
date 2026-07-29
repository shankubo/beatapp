/**
 * Fonds de couleur unie, importes comme des images ordinaires.
 *
 * Choix structurel: on GENERE un vrai PNG plutot que d'ajouter une sorte de
 * media « couleur ». Le compositeur, les vignettes, la timeline et l'export
 * traitent alors ce fond exactement comme une photo, sans un seul cas
 * particulier — c'est ce qui rend la fonctionnalite gratuite en aval.
 *
 * Un fond uni sert de carton de titre, de separateur entre deux plans, ou de
 * support pour du texte qu'une photo chargee rendrait illisible.
 */

import type { MediaAsset } from '../../domain/types';

/**
 * Cote du PNG genere, en pixels.
 *
 * Carre et modeste: une couleur unie n'a aucun detail, donc la resolution
 * n'apporte rien. Le compositeur met a l'echelle pour remplir la frame, et un
 * carre evite de privilegier une orientation. 64 px suffisent et pesent moins
 * d'un kilo-octet.
 */
const SWATCH_SIZE = 64;

/**
 * Identifiants des couleurs de la palette.
 *
 * Enumeres pour que `nameKey` soit un type LITTERAL et non `string`: le typage
 * des cles i18n du projet refuse un `string` quelconque, et c'est precisement ce
 * garde-fou qui fait echouer la compilation si une couleur est ajoutee ici sans
 * sa traduction.
 */
export type ColorId =
  | 'black' | 'charcoal' | 'slate' | 'silver' | 'white' | 'cream'
  | 'red' | 'coral' | 'orange' | 'yellow' | 'chartreuse' | 'green'
  | 'teal' | 'cyan' | 'blue' | 'indigo' | 'purple' | 'magenta' | 'pink'
  | 'burgundy' | 'forest' | 'navy' | 'brown' | 'sand';

/**
 * Une couleur proposee.
 *
 * `nameKey` est une cle i18n et non un nom en clair: les noms de couleur se
 * traduisent, et le projet interdit toute chaine UI en dur.
 */
export interface ColorSwatch {
  id: ColorId;
  hex: string;
  nameKey: `editor:colors.${ColorId}`;
}

/**
 * Palette proposee.
 *
 * Construite pour l'usage et non pour l'exhaustivite. Une roue chromatique
 * complete serait inutilisable au doigt sur 390 px, et le champ de couleur libre
 * la remplace pour les cas particuliers.
 *
 * Trois familles: des neutres (fonds de titre, la base la plus utile), des
 * teintes vives qui ressortent sur un fil Instagram, et des tons sourds qui
 * laissent du texte clair lisible par-dessus.
 */
export const COLOR_SWATCHES: readonly ColorSwatch[] = [
  // Neutres.
  { id: 'black', hex: '#000000', nameKey: 'editor:colors.black' },
  { id: 'charcoal', hex: '#1c1c1e', nameKey: 'editor:colors.charcoal' },
  { id: 'slate', hex: '#4a5058', nameKey: 'editor:colors.slate' },
  { id: 'silver', hex: '#c9ccd1', nameKey: 'editor:colors.silver' },
  { id: 'white', hex: '#ffffff', nameKey: 'editor:colors.white' },
  { id: 'cream', hex: '#f4ead8', nameKey: 'editor:colors.cream' },
  // Vives.
  { id: 'red', hex: '#e5322d', nameKey: 'editor:colors.red' },
  { id: 'coral', hex: '#ff5c38', nameKey: 'editor:colors.coral' },
  { id: 'orange', hex: '#f7941d', nameKey: 'editor:colors.orange' },
  { id: 'yellow', hex: '#ffd21e', nameKey: 'editor:colors.yellow' },
  { id: 'chartreuse', hex: '#e8ff3a', nameKey: 'editor:colors.chartreuse' },
  { id: 'green', hex: '#2ecc71', nameKey: 'editor:colors.green' },
  { id: 'teal', hex: '#12b5a5', nameKey: 'editor:colors.teal' },
  { id: 'cyan', hex: '#4cc9f0', nameKey: 'editor:colors.cyan' },
  { id: 'blue', hex: '#2f6df6', nameKey: 'editor:colors.blue' },
  { id: 'indigo', hex: '#3b2fb8', nameKey: 'editor:colors.indigo' },
  { id: 'purple', hex: '#8b5cf6', nameKey: 'editor:colors.purple' },
  { id: 'magenta', hex: '#e6399b', nameKey: 'editor:colors.magenta' },
  { id: 'pink', hex: '#ff8fb1', nameKey: 'editor:colors.pink' },
  // Sourdes.
  { id: 'burgundy', hex: '#6d213c', nameKey: 'editor:colors.burgundy' },
  { id: 'forest', hex: '#1f4d36', nameKey: 'editor:colors.forest' },
  { id: 'navy', hex: '#16244a', nameKey: 'editor:colors.navy' },
  { id: 'brown', hex: '#6b4a2f', nameKey: 'editor:colors.brown' },
  { id: 'sand', hex: '#c8a97e', nameKey: 'editor:colors.sand' },
];

/** Valide une couleur `#rrggbb`. Refuse toute autre forme. */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

/**
 * Normalise une couleur en `#rrggbb` minuscule, ou `null` si elle est invalide.
 *
 * La valeur peut venir du champ natif `<input type="color">`, dont la casse
 * varie selon le navigateur: sans normalisation, la meme couleur produirait deux
 * medias distincts.
 */
export function normalizeHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return isHexColor(trimmed) ? trimmed : null;
}

/**
 * Rend un PNG carre d'une couleur unie.
 *
 * Leve si le contexte 2D n'est pas disponible ou si l'encodage echoue: l'appelant
 * doit le signaler, pas l'ignorer — un import silencieusement sans effet est le
 * pire des comportements.
 */
export async function renderColorBlob(hex: string): Promise<Blob> {
  const normalized = normalizeHex(hex);
  if (!normalized) throw new Error(`Couleur invalide: ${hex}`);

  const canvas = document.createElement('canvas');
  canvas.width = SWATCH_SIZE;
  canvas.height = SWATCH_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Contexte 2D indisponible');

  ctx.fillStyle = normalized;
  ctx.fillRect(0, 0, SWATCH_SIZE, SWATCH_SIZE);

  const blob = await new Promise<Blob | null>((resolve) => {
    // PNG et non JPEG: une couleur unie doit rester EXACTE, et la compression
    // avec perte du JPEG decalerait la teinte de quelques valeurs.
    canvas.toBlob(resolve, 'image/png');
  });
  if (!blob) throw new Error('Encodage PNG echoue');
  return blob;
}

/**
 * Metadonnees du media pour une couleur.
 *
 * `name` porte le code hexadecimal et non un nom traduit: c'est un nom de
 * fichier technique, affiche tel quel, et il doit rester stable quelle que soit
 * la langue de l'interface.
 */
export function colorAssetMetadata(
  hex: string,
  blob: Blob,
): Omit<MediaAsset, 'id' | 'storage'> {
  return {
    kind: 'image',
    name: hex,
    mimeType: 'image/png',
    bytes: blob.size,
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    createdAt: Date.now(),
  };
}
