/**
 * L'apercu d'un modele montre-t-il vraiment un montage ?
 *
 * En test NAVIGATEUR: `createImageBitmap`, le canvas 2D et le compositeur ont
 * besoin d'un vrai moteur.
 *
 * Ce qui est verifie n'est pas l'esthetique mais le CONTRAT: l'apercu emprunte
 * la seule voie de rendu du projet (`buildScene` + `Compositor.draw`), et une
 * coupe s'y produit reellement — c'est-a-dire que deux instants distincts ne
 * donnent pas la meme image. Sans cela, l'apercu pourrait afficher un plan fixe
 * en pretendant montrer une cadence.
 */

import { describe, expect, it } from 'vitest';

import { draw } from '@/engine/Compositor';
import { buildScene } from '@/engine/SceneGraph';
import { TEMPLATES } from '@/features/samples/templates';
import {
  previewCache,
  previewCards,
  previewProject,
} from '@/features/samples/templatePreview';
import { videoDuration } from '@/domain/timeline';

const WIDTH = 90;
const HEIGHT = 160;

/** Rend un instant de l'apercu et renvoie ses pixels. */
async function renderAt(templateIndex: number, time: number): Promise<Uint8ClampedArray> {
  const cards = await previewCards();
  const template = TEMPLATES[templateIndex]!;
  const project = previewProject(template, cards.length);
  const cache = previewCache(cards);

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('contexte 2d indisponible');

  draw(buildScene(project, time, cache), { ctx, width: WIDTH, height: HEIGHT });
  return ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
}

/** Distance moyenne entre deux images, par canal. */
function difference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i]! - b[i]!);
  return total / a.length;
}

describe('apercu de modele', () => {
  it('genere autant de cartes que de plans, mises en cache', async () => {
    const first = await previewCards();
    const second = await previewCards();
    expect(first.length).toBeGreaterThan(1);
    // Meme instance: regenerer a chaque ouverture serait du travail refait pour
    // un resultat au pixel pres identique.
    expect(second).toBe(first);
  });

  it('construit un montage de la duree annoncee par le modele', async () => {
    const cards = await previewCards();
    for (const template of TEMPLATES) {
      const project = previewProject(template, cards.length);
      expect(project.videoTrack.clips.length, template.id).toBeGreaterThan(0);
      // Tolerance d'une demi-frame par plan: `ripple` aligne sur la grille.
      const slack = project.videoTrack.clips.length * 0.5 * (1 / project.frame.fps);
      expect(
        Math.abs(videoDuration(project.videoTrack) - template.targetDuration),
        template.id,
      ).toBeLessThanOrEqual(slack);
    }
  });

  it('dessine des pixels, et pas un cadre vide', async () => {
    const pixels = await renderAt(0, 0.1);
    let opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i]! > 0) opaque += 1;
    }
    // Le premier plan couvre le cadre en `cover`: la quasi-totalite est opaque.
    expect(opaque / (pixels.length / 4)).toBeGreaterThan(0.9);
  });

  it('change d image d un plan a l autre', async () => {
    /*
      Le coeur du test: sans coupe, l'apercu ne dirait rien de la cadence — il
      montrerait une image fixe en pretendant montrer un montage.

      « Diaporama rythme » dure 15 s pour 6 cartes, soit 2,5 s par plan: 0,3 s et
      3,5 s tombent donc sur deux plans differents.
    */
    const first = await renderAt(0, 0.3);
    const second = await renderAt(0, 3.5);
    expect(difference(first, second)).toBeGreaterThan(5);
  });

  it('reste stable a l interieur d un meme plan', async () => {
    // Deux instants du MEME plan, loin des transitions: l'image ne doit pas
    // deriver. « Diaporama rythme » n'a pas de zoom lent.
    const a = await renderAt(0, 0.4);
    const b = await renderAt(0, 0.6);
    expect(difference(a, b)).toBeLessThan(1);
  });
});
