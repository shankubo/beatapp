/**
 * Aller-retour d'export: le test a plus forte valeur de la suite.
 *
 * WebCodecs, OffscreenCanvas et OfflineAudioContext ne se mockent pas
 * utilement: ce test tourne donc dans un vrai Chromium. Il verifie que le
 * pipeline produit un MP4 que le navigateur sait relire, et que le rendu passe
 * bien par le meme compositeur que l'apercu.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { exportMp4, qualityDimensions, QUALITY_MEDIUM } from '@/export/webcodecs';
import { probeExportCapability, resetCapabilityCache } from '@/export/capability';
import { draw } from '@/engine/Compositor';
import { buildScene } from '@/engine/SceneGraph';
import { StaticMediaCache, type FrameSource } from '@/engine/MediaCache';
import { createEmptyProject } from '@/domain/project';
import { appendClip } from '@/domain/timeline';
import { newId } from '@/lib/id';
import type { Clip, MediaAsset, Project } from '@/domain/types';

/** Image de test: un damier, pour que la difference soit mesurable. */
async function checkerBitmap(size = 256): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e8ff3a';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#0d0e0c';
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if ((x + y) % 2 === 0) ctx.fillRect((x * size) / 8, (y * size) / 8, size / 8, size / 8);
    }
  }
  return canvas.transferToImageBitmap();
}

function imageAsset(id: string, width: number, height: number): MediaAsset {
  return {
    id,
    kind: 'image',
    name: 'checker.png',
    mimeType: 'image/png',
    bytes: 1024,
    storage: { backend: 'idb', key: `${id}.bin` },
    width,
    height,
    createdAt: Date.now(),
  };
}

function clipFor(assetId: string, duration: number): Clip {
  return {
    id: newId('clip'),
    assetId,
    start: 0,
    duration,
    fit: 'cover',
    transform: { scale: 1, x: 0, y: 0, rotation: 0 },
    muted: false,
  };
}

/** Projet minimal: deux diapositives d'une demi-seconde. */
async function buildTestProject(): Promise<{
  project: Project;
  cache: StaticMediaCache;
}> {
  const bitmap = await checkerBitmap();
  const asset = imageAsset('asset_test', bitmap.width, bitmap.height);

  let project = createEmptyProject('Test');
  project = { ...project, assets: { [asset.id]: asset } };
  project = {
    ...project,
    videoTrack: appendClip(project.videoTrack, clipFor(asset.id, 0.5), project.frame.fps),
  };
  project = {
    ...project,
    videoTrack: appendClip(project.videoTrack, clipFor(asset.id, 0.5), project.frame.fps),
  };

  const frames = new Map<string, FrameSource>([
    [asset.id, { image: bitmap, width: bitmap.width, height: bitmap.height }],
  ]);

  return { project, cache: new StaticMediaCache(frames) };
}

/** Lit les metadonnees d'un blob video via un element `<video>`. */
function probeVideo(blob: Blob): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.preload = 'metadata';

    const cleanup = () => URL.revokeObjectURL(url);

    video.onloadedmetadata = () => {
      const result = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      cleanup();
      resolve(result);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('le navigateur ne sait pas decoder le fichier produit'));
    };
    video.src = url;
  });
}

describe('capacite d export', () => {
  beforeAll(() => resetCapabilityCache());

  it('detecte WebCodecs et distingue les resolutions', async () => {
    const probe = await probeExportCapability();
    expect(probe.details.webCodecsPresent).toBe(true);
    // Au moins une resolution doit etre encodable dans Chromium.
    expect(probe.supported.high || probe.supported.medium).toBe(true);
  });
});

describe('exportMp4', () => {
  it('produit un MP4 que le navigateur sait relire', async () => {
    const { project, cache } = await buildTestProject();

    const result = await exportMp4(project, cache, new Map(), {
      tier: QUALITY_MEDIUM,
    });

    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.blob.type).toBe('video/mp4');

    // Boite `ftyp` a l'offset 4: signature d'un conteneur ISO-BMFF valide.
    const head = new Uint8Array(await result.blob.slice(0, 12).arrayBuffer());
    expect(String.fromCharCode(...head.slice(4, 8))).toBe('ftyp');

    // Le navigateur doit savoir le decoder: c'est la preuve que le fichier est
    // reellement exploitable, et non seulement bien forme.
    const meta = await probeVideo(result.blob);
    // Les dimensions se deduisent du palier ET du format du projet: on interroge
    // donc la meme fonction que l'encodeur plutot que de figer des nombres.
    const expected = qualityDimensions(QUALITY_MEDIUM, project.frame);
    expect(meta.width).toBe(expected.width);
    expect(meta.height).toBe(expected.height);
    // 1 seconde de montage, a une frame pres.
    expect(meta.duration).toBeGreaterThan(0.9);
    expect(meta.duration).toBeLessThan(1.2);
  }, 60_000);

  it('encode exactement le nombre de frames attendu', async () => {
    const { project, cache } = await buildTestProject();
    const result = await exportMp4(project, cache, new Map(), { tier: QUALITY_MEDIUM });

    // 1 s a 30 fps: le rendu deterministe ne doit ni perdre ni ajouter de frame.
    expect(result.frameCount).toBe(30);
    expect(result.durationSeconds).toBeCloseTo(1, 5);
  }, 60_000);

  it('rapporte la progression jusqu a 100 %', async () => {
    const { project, cache } = await buildTestProject();
    const fractions: number[] = [];

    await exportMp4(project, cache, new Map(), {
      tier: QUALITY_MEDIUM,
      onProgress: (progress) => fractions.push(progress.fraction),
    });

    expect(fractions.length).toBeGreaterThan(2);
    // Monotone croissante et complete: une barre qui reculerait serait un bug.
    for (let i = 1; i < fractions.length; i += 1) {
      expect(fractions[i]!).toBeGreaterThanOrEqual(fractions[i - 1]!);
    }
    expect(fractions[fractions.length - 1]!).toBeCloseTo(1, 2);
  }, 60_000);

  it('refuse un projet vide avec une cle d erreur traduisible', async () => {
    const project = createEmptyProject('Vide');
    const cache = new StaticMediaCache(new Map());

    await expect(exportMp4(project, cache, new Map())).rejects.toMatchObject({
      i18nKey: 'errors:export.empty',
    });
  });

  it('honore l annulation', async () => {
    const { project, cache } = await buildTestProject();
    const controller = new AbortController();
    // Annulation immediate: l'export ne doit pas produire de fichier.
    controller.abort();

    await expect(
      exportMp4(project, cache, new Map(), {
        tier: QUALITY_MEDIUM,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  }, 30_000);
});

describe('parite apercu / export', () => {
  it('dessine la meme image dans les deux voies', async () => {
    // C'est la defense mecanique contre la divergence apercu/export: le meme
    // `Compositor.draw` est appele avec deux tailles de canvas, et on compare
    // les images une fois ramenees a la meme echelle.
    const { project, cache } = await buildTestProject();
    const time = 0.25;
    const scene = buildScene(project, time, cache);

    const render = (width: number, height: number) => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d', { alpha: false })!;
      draw(scene, { ctx, width, height });
      return ctx.getImageData(0, 0, width, height);
    };

    // Taille d'apercu et taille d'export, dans le meme rapport 9:16.
    const preview = render(180, 320);
    const exported = render(720, 1280);

    /**
     * Luminance moyenne d'une zone, en coordonnees normalisees.
     *
     * On compare des MOYENNES de zone et non des pixels isoles: le damier est
     * un motif haute frequence, et sur la frontiere entre deux cases un ecart
     * d'un seul pixel entre les deux echelles fait basculer du noir au jaune.
     * Comparer des pixels exacts testerait la coincidence des grilles de
     * reechantillonnage, pas la parite du rendu.
     */
    const meanLuma = (
      image: ImageData,
      u: number,
      v: number,
      halfSpan = 0.04,
    ): number => {
      const x0 = Math.max(0, Math.floor((u - halfSpan) * image.width));
      const x1 = Math.min(image.width - 1, Math.ceil((u + halfSpan) * image.width));
      const y0 = Math.max(0, Math.floor((v - halfSpan) * image.height));
      const y1 = Math.min(image.height - 1, Math.ceil((v + halfSpan) * image.height));

      let sum = 0;
      let count = 0;
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const i = (y * image.width + x) * 4;
          // Luminance perceptuelle: une seule grandeur a comparer.
          sum +=
            0.2126 * image.data[i]! + 0.7152 * image.data[i + 1]! + 0.0722 * image.data[i + 2]!;
          count += 1;
        }
      }
      return count > 0 ? sum / count : 0;
    };

    let compared = 0;
    for (let gy = 1; gy < 6; gy += 1) {
      for (let gx = 1; gx < 6; gx += 1) {
        const u = gx / 6;
        const v = gy / 6;
        // Tolerance de 12/255 sur la luminance moyenne: assez serre pour
        // detecter un cadrage ou une transformation divergents, assez large
        // pour absorber le reechantillonnage.
        expect(Math.abs(meanLuma(preview, u, v) - meanLuma(exported, u, v))).toBeLessThan(12);
        compared += 1;
      }
    }
    expect(compared).toBe(25);
  });
});
