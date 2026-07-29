/**
 * Rendu des fonds de couleur unie.
 *
 * Le rendu passe par un canvas, donc ces tests ont besoin d'un vrai navigateur.
 * Ce qui compte ici: le PNG doit porter EXACTEMENT la couleur demandee. Une
 * derive de quelques valeurs serait invisible a l'oeil sur une vignette mais
 * ruinerait un fond de titre pose a cote d'une couleur de marque.
 */

import { describe, expect, it } from 'vitest';

import { COLOR_SWATCHES, renderColorBlob } from '@/features/import/colorSwatches';

/** Lit le pixel central du blob, en RGBA. */
async function centerPixel(blob: Blob): Promise<[number, number, number, number]> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(
    Math.floor(bitmap.width / 2),
    Math.floor(bitmap.height / 2),
    1,
    1,
  ).data;
  return [data[0]!, data[1]!, data[2]!, data[3]!];
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

describe('renderColorBlob', () => {
  it('produit un PNG', async () => {
    const blob = await renderColorBlob('#ff0000');
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('rend la couleur EXACTE, sans derive', async () => {
    // PNG et non JPEG precisement pour cela: la compression avec perte
    // decalerait la teinte.
    const [r, g, b, a] = await centerPixel(await renderColorBlob('#4cc9f0'));
    expect([r, g, b]).toEqual(hexToRgb('#4cc9f0'));
    // Opaque: un fond translucide laisserait passer le noir du compositeur.
    expect(a).toBe(255);
  });

  it('rend correctement les extremes', async () => {
    const black = await centerPixel(await renderColorBlob('#000000'));
    expect(black).toEqual([0, 0, 0, 255]);
    const white = await centerPixel(await renderColorBlob('#ffffff'));
    expect(white).toEqual([255, 255, 255, 255]);
  });

  it('accepte une couleur en majuscules', async () => {
    // Le champ natif renvoie une casse variable selon le navigateur.
    const [r, g, b] = await centerPixel(await renderColorBlob('#4CC9F0'));
    expect([r, g, b]).toEqual(hexToRgb('#4cc9f0'));
  });

  it('rend toute la palette fidelement', async () => {
    for (const swatch of COLOR_SWATCHES) {
      const [r, g, b] = await centerPixel(await renderColorBlob(swatch.hex));
      expect([r, g, b], swatch.id).toEqual(hexToRgb(swatch.hex));
    }
  });

  it('produit une image carree et uniforme', async () => {
    const bitmap = await createImageBitmap(await renderColorBlob('#2ecc71'));
    expect(bitmap.width).toBe(bitmap.height);

    // On verifie les quatre coins en plus du centre: un degrade accidentel ou un
    // bord non peint passerait un test qui ne regarde qu'un seul pixel.
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const expected = hexToRgb('#2ecc71');

    const corners = [
      [0, 0],
      [bitmap.width - 1, 0],
      [0, bitmap.height - 1],
      [bitmap.width - 1, bitmap.height - 1],
    ] as const;

    for (const [x, y] of corners) {
      const i = (y * bitmap.width + x) * 4;
      expect([image.data[i], image.data[i + 1], image.data[i + 2]]).toEqual(expected);
    }
  });

  it('refuse une couleur invalide', async () => {
    // Echouer bruyamment plutot que de produire un fond noir inattendu.
    await expect(renderColorBlob('#fff')).rejects.toThrow();
    await expect(renderColorBlob('rouge')).rejects.toThrow();
  });
});
