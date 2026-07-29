/**
 * Palette et validation des fonds de couleur.
 *
 * Seules les parties PURES sont testees ici: le rendu PNG passe par un canvas et
 * appartient donc aux tests navigateur.
 */

import { describe, expect, it } from 'vitest';

import {
  COLOR_SWATCHES,
  colorAssetMetadata,
  isHexColor,
  normalizeHex,
} from '@/features/import/colorSwatches';

describe('isHexColor', () => {
  it('accepte la forme #rrggbb', () => {
    expect(isHexColor('#000000')).toBe(true);
    expect(isHexColor('#ffffff')).toBe(true);
    expect(isHexColor('#4CC9F0')).toBe(true);
  });

  it('refuse les autres formes', () => {
    // La forme courte, les noms CSS et les fonctions ne sont pas acceptes: le
    // rendu et le nom du media supposent exactement six chiffres hexadecimaux.
    expect(isHexColor('#fff')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('rgb(1,2,3)')).toBe(false);
    expect(isHexColor('#12345g')).toBe(false);
    expect(isHexColor('')).toBe(false);
  });

  it('tolere les espaces autour', () => {
    expect(isHexColor('  #123456  ')).toBe(true);
  });
});

describe('normalizeHex', () => {
  it('ramene en minuscules', () => {
    // Le champ natif `<input type="color">` renvoie une casse variable selon le
    // navigateur: sans normalisation, la meme couleur creerait deux medias.
    expect(normalizeHex('#4CC9F0')).toBe('#4cc9f0');
  });

  it('renvoie null pour une valeur invalide', () => {
    expect(normalizeHex('#fff')).toBeNull();
    expect(normalizeHex('bleu')).toBeNull();
  });
});

describe('COLOR_SWATCHES', () => {
  it('ne contient que des couleurs valides', () => {
    for (const swatch of COLOR_SWATCHES) {
      expect(isHexColor(swatch.hex)).toBe(true);
      // Deja normalisees: la palette est ecrite a la main, une majuscule
      // creerait un doublon avec une couleur choisie librement.
      expect(swatch.hex).toBe(swatch.hex.toLowerCase());
    }
  });

  it('n a ni identifiant ni teinte en double', () => {
    const ids = COLOR_SWATCHES.map((swatch) => swatch.id);
    const hexes = COLOR_SWATCHES.map((swatch) => swatch.hex);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it('passe toutes ses etiquettes par i18n', () => {
    // Garde-fou de la regle « aucune chaine UI en dur »: un nom de couleur en
    // clair passerait la compilation mais ne se traduirait pas.
    for (const swatch of COLOR_SWATCHES) {
      expect(swatch.nameKey).toMatch(/^editor:colors\./);
    }
  });
});

describe('colorAssetMetadata', () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

  it('produit un media image', () => {
    // C'est tout l'interet: en aval, un fond uni est une image ordinaire.
    const meta = colorAssetMetadata('#ff0000', blob);
    expect(meta.kind).toBe('image');
    expect(meta.mimeType).toBe('image/png');
  });

  it('porte le code hexadecimal comme nom', () => {
    // Un nom technique et stable, independant de la langue de l'interface.
    expect(colorAssetMetadata('#ff0000', blob).name).toBe('#ff0000');
  });

  it('renseigne des dimensions carrees', () => {
    const meta = colorAssetMetadata('#ff0000', blob);
    expect(meta.width).toBe(meta.height);
    expect(meta.width).toBeGreaterThan(0);
  });

  it('n annonce aucune duree', () => {
    // Une image fixe: une duree ferait croire a une video et changerait le
    // comportement de la timeline.
    expect(colorAssetMetadata('#ff0000', blob).duration).toBeUndefined();
  });
});
