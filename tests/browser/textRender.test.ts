/**
 * Un texte doit etre visible DES l'instant ou il commence.
 *
 * Regression: le panneau Texte pose l'incrustation a la position de lecture
 * courante. Elle etait donc rendue a `progressIn = 0`, ou l'animation d'entree
 * l'annule — et par DEUX chemins distincts, ce que ces tests ont revele:
 * l'opacite tombe a zero (`fade`, `slideUp`), et `popIn` dessine en plus a une
 * echelle nulle, sans aucune surface. Corriger l'opacite seule ne suffisait
 * donc pas.
 *
 * On mesure des PIXELS et non un etat interne: c'est la seule facon de verifier
 * ce que l'utilisateur voit reellement, et cela couvre du coup toute la chaine
 * `buildScene` -> `Compositor.draw` -> `TextRenderer`.
 */

import { describe, expect, it } from 'vitest';

import { draw } from '@/engine/Compositor';
import { buildScene } from '@/engine/SceneGraph';
import { StaticMediaCache, type FrameSource } from '@/engine/MediaCache';
import { createEmptyProject, createTextOverlay } from '@/domain/project';
import { appendClip } from '@/domain/timeline';
import type { MediaAsset, Project, TextAnim } from '@/domain/types';

async function blackBitmap(size = 256): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  return canvas.transferToImageBitmap();
}

function imageAsset(id: string, width: number, height: number): MediaAsset {
  return {
    id,
    kind: 'image',
    name: 'black.png',
    mimeType: 'image/png',
    bytes: 512,
    storage: { backend: 'idb', key: `${id}.bin` },
    width,
    height,
    createdAt: Date.now(),
  };
}

/** Projet d'un seul plan noir, avec un texte blanc demarrant a `start`. */
async function projectWithText(
  start: number,
  animation: TextAnim,
): Promise<{ project: Project; cache: StaticMediaCache }> {
  const bitmap = await blackBitmap();
  const asset = imageAsset('asset_black', bitmap.width, bitmap.height);

  let project = createEmptyProject('Texte');
  project = { ...project, assets: { [asset.id]: asset } };
  project = {
    ...project,
    videoTrack: appendClip(
      project.videoTrack,
      {
        id: 'clip_1',
        assetId: asset.id,
        start: 0,
        duration: 10,
        fit: 'cover',
        transform: { scale: 1, x: 0, y: 0, rotation: 0 },
        muted: false,
      },
      project.frame.fps,
    ),
  };

  const overlay = createTextOverlay('TEXTE VISIBLE', { start });
  project = {
    ...project,
    overlays: [
      { ...overlay, animation: { ...overlay.animation, in: animation } },
    ],
  };

  const frames = new Map<string, FrameSource>([
    [asset.id, { image: bitmap, width: bitmap.width, height: bitmap.height }],
  ]);

  return { project, cache: new StaticMediaCache(frames) };
}

/**
 * Luminance TOTALE de la frame. Le fond est noir uni: tout apport vient du
 * texte.
 *
 * On somme la luminance au lieu de compter les pixels au-dessus d'un seuil: un
 * comptage seuille sature des que le texte est un peu visible et ne distingue
 * plus « a peine present » de « pleinement affiche », ce qui est precisement la
 * difference qu'on veut mesurer.
 */
function totalLuma(image: ImageData): number {
  let sum = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    sum +=
      0.2126 * image.data[i]! + 0.7152 * image.data[i + 1]! + 0.0722 * image.data[i + 2]!;
  }
  return sum;
}

function render(project: Project, cache: StaticMediaCache, time: number): ImageData {
  const width = 360;
  const height = 640;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  draw(buildScene(project, time, cache), { ctx, width, height });
  return ctx.getImageData(0, 0, width, height);
}

describe('visibilite du texte', () => {
  /**
   * Le cas exact du bug: la tete de lecture est pile sur le debut du texte.
   *
   * Chaque animation d'entree est couverte, car chacune ramenait le texte a
   * l'invisibilite par un chemin different (opacite pour `fade` et `popIn`,
   * nombre de caracteres reveles pour `typewriter`).
   */
  for (const animation of ['fade', 'popIn', 'slideUp', 'typewriter'] as const) {
    it(`dessine quelque chose des le premier instant (${animation})`, async () => {
      const start = 4;
      const { project, cache } = await projectWithText(start, animation);

      const atStart = render(project, cache, start);
      expect(totalLuma(atStart)).toBeGreaterThan(0);
    });
  }

  it('reste bien plus visible une fois l animation terminee', async () => {
    const start = 4;
    const { project, cache } = await projectWithText(start, 'fade');
    const overlay = project.overlays[0]!;

    const atStart = totalLuma(render(project, cache, start));
    const settled = totalLuma(
      render(project, cache, start + overlay.animation.duration + 0.1),
    );

    // Le plancher rend le texte PRESENT, il ne supprime pas le fondu: l'etat
    // stabilise doit rester nettement plus lumineux que le premier instant.
    expect(settled).toBeGreaterThan(atStart * 1.8);
  });

  it('a bel et bien disparu apres sa fin', async () => {
    const start = 4;
    const { project, cache } = await projectWithText(start, 'fade');
    const overlay = project.overlays[0]!;

    // Le plancher ne s'applique qu'a l'ENTREE: passe la fin, plus rien.
    const after = render(project, cache, start + overlay.duration + 0.5);
    expect(totalLuma(after)).toBe(0);
  });
});
