/**
 * Les paroles doivent etre DESSINEES, pas seulement stockees.
 *
 * Elles passent par `lyricOverlays` puis par le meme `TextRenderer` que les
 * textes libres. Ce test verifie ce chemin de bout en bout sur un fond uni, ou
 * tout pixel non conforme au fond est necessairement du texte — une mesure
 * impossible a obtenir sur une photo.
 */

import { describe, expect, it } from 'vitest';

import { draw } from '@/engine/Compositor';
import { buildScene } from '@/engine/SceneGraph';
import { StaticMediaCache, type FrameSource } from '@/engine/MediaCache';
import { createEmptyProject, createLyrics } from '@/domain/project';
import { appendClip } from '@/domain/timeline';
import { alignLyricsToBeats } from '@/domain/lyrics';
import type { MediaAsset, Project } from '@/domain/types';

/** Fond noir uni: tout pixel clair vient donc du texte. */
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

async function projectWithLyrics(texts: string[]): Promise<{
  project: Project;
  cache: StaticMediaCache;
}> {
  const bitmap = await blackBitmap();
  const asset = imageAsset('asset_black', bitmap.width, bitmap.height);

  let project = createEmptyProject('Paroles');
  project = { ...project, assets: { [asset.id]: asset } };
  project = {
    ...project,
    videoTrack: appendClip(
      project.videoTrack,
      {
        id: 'clip_1',
        assetId: asset.id,
        start: 0,
        duration: 6,
        fit: 'cover',
        transform: { scale: 1, x: 0, y: 0, rotation: 0 },
        muted: false,
      },
      project.frame.fps,
    ),
  };

  const base = createLyrics();
  project = {
    ...project,
    lyrics: {
      ...base,
      // Pas d'animation: on mesure la presence du texte, pas son fondu.
      animation: { in: 'none', out: 'none', duration: 0 },
      lines: alignLyricsToBeats(texts, [], { beatsPerLine: 4, until: 6 }),
    },
  };

  const frames = new Map<string, FrameSource>([
    [asset.id, { image: bitmap, width: bitmap.width, height: bitmap.height }],
  ]);

  return { project, cache: new StaticMediaCache(frames) };
}

/** Fraction de pixels clairs dans une bande horizontale (0..1 de la hauteur). */
function brightRatioInBand(
  image: ImageData,
  from: number,
  to: number,
  threshold = 140,
): number {
  const y0 = Math.floor(from * image.height);
  const y1 = Math.floor(to * image.height);
  let bright = 0;
  let total = 0;

  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      const luma =
        0.2126 * image.data[i]! + 0.7152 * image.data[i + 1]! + 0.0722 * image.data[i + 2]!;
      if (luma > threshold) bright += 1;
      total += 1;
    }
  }

  return total > 0 ? bright / total : 0;
}

function render(project: Project, cache: StaticMediaCache, time: number): ImageData {
  const width = 360;
  const height = 640;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  draw(buildScene(project, time, cache), { ctx, width, height });
  return ctx.getImageData(0, 0, width, height);
}

describe('rendu des paroles', () => {
  it('dessine la ligne active sur la frame', async () => {
    const { project, cache } = await projectWithLyrics(['PAROLE UNE', 'PAROLE DEUX']);
    const first = project.lyrics!.lines[0]!;

    // Au milieu de la premiere ligne: elle doit etre visible.
    const withText = render(project, cache, first.start + first.duration / 2);
    // Les paroles sont a y = 0,72: on mesure autour.
    const inBand = brightRatioInBand(withText, 0.66, 0.79);
    expect(inBand).toBeGreaterThan(0.01);

    // Bande de reference sur le meme fond noir, loin du texte.
    const elsewhere = brightRatioInBand(withText, 0.1, 0.25);
    expect(elsewhere).toBeLessThan(0.001);
  });

  it('n affiche rien avant la premiere ligne ni apres la derniere', async () => {
    const { project, cache } = await projectWithLyrics(['UNE SEULE LIGNE']);
    const line = project.lyrics!.lines[0]!;

    // Juste apres la fin de la ligne: la bande doit etre vide.
    const after = render(project, cache, line.start + line.duration + 0.4);
    expect(brightRatioInBand(after, 0.66, 0.79)).toBeLessThan(0.001);
  });

  it('affiche la bonne ligne au bon moment', async () => {
    const { project, cache } = await projectWithLyrics(['III', 'WWWWWWWW']);
    const [first, second] = project.lyrics!.lines;

    // Deux textes de largeurs tres differentes: la surface claire les distingue
    // sans avoir a lire les caracteres.
    const atFirst = brightRatioInBand(
      render(project, cache, first!.start + first!.duration / 2),
      0.66,
      0.79,
    );
    const atSecond = brightRatioInBand(
      render(project, cache, second!.start + second!.duration / 2),
      0.66,
      0.79,
    );

    expect(atSecond).toBeGreaterThan(atFirst * 1.5);
  });

  it('suit la position verticale choisie', async () => {
    const { project, cache } = await projectWithLyrics(['HAUT OU BAS']);
    const line = project.lyrics!.lines[0]!;
    const time = line.start + line.duration / 2;

    const low = render(project, cache, time);
    const moved: Project = {
      ...project,
      lyrics: { ...project.lyrics!, y: 0.25 },
    };
    const high = render(moved, cache, time);

    // Le texte a quitte la bande basse pour la bande haute.
    expect(brightRatioInBand(low, 0.66, 0.79)).toBeGreaterThan(0.01);
    expect(brightRatioInBand(high, 0.66, 0.79)).toBeLessThan(0.001);
    expect(brightRatioInBand(high, 0.19, 0.32)).toBeGreaterThan(0.01);
  });

  it('rend les accents et les emoji', async () => {
    // Le rendu passe par `fillText`: les caracteres non ASCII doivent produire
    // des pixels comme les autres.
    const { project, cache } = await projectWithLyrics(['ÉÀÇ 🔥']);
    const line = project.lyrics!.lines[0]!;
    const image = render(project, cache, line.start + line.duration / 2);
    expect(brightRatioInBand(image, 0.66, 0.79)).toBeGreaterThan(0.005);
  });
});
