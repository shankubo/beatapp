/**
 * Masque texte, mesure en PIXELS.
 *
 * Le principe est inversable a l'oeil mais pas dans le modele: les lettres
 * DECOUPENT le voile, elles ne sont pas dessinees. Une erreur de sens produit
 * exactement l'image complementaire — un ecran plein sauf les lettres — et
 * aucun test d'etat interne ne peut la distinguer du bon rendu.
 *
 * On peint donc un clip BLANC sous un voile NOIR: a l'interieur d'une lettre on
 * doit lire du blanc, en dehors du noir.
 */

import { describe, expect, it } from 'vitest';

import { draw } from '@/engine/Compositor';
import { buildScene } from '@/engine/SceneGraph';
import { StaticMediaCache, type FrameSource } from '@/engine/MediaCache';
import { createEmptyProject, createTextMask } from '@/domain/project';
import { appendClip } from '@/domain/timeline';
import type { MediaAsset, Project, TextMask } from '@/domain/types';

const WIDTH = 240;
const HEIGHT = 400;

/** Clip BLANC: tout ce qui reste blanc a l'ecran est une zone decoupee. */
async function whiteBitmap(size = 256): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  return canvas.transferToImageBitmap();
}

function imageAsset(id: string): MediaAsset {
  return {
    id,
    kind: 'image',
    name: 'white.png',
    mimeType: 'image/png',
    bytes: 512,
    storage: { backend: 'idb', key: `${id}.bin` },
    width: 256,
    height: 256,
    createdAt: Date.now(),
  };
}

async function projectWithMask(
  patch: Partial<TextMask> = {},
): Promise<{ project: Project; cache: StaticMediaCache }> {
  const bitmap = await whiteBitmap();
  const asset = imageAsset('asset_white');

  let project = createEmptyProject('Masque');
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

  /*
    Un rectangle plein « █ » plutot qu'une lettre.

    Un « A » a un centre EVIDE: viser son milieu tomberait dans le contrepoinçon
    et lirait la couleur du voile, pas l'image. Le test porte sur le sens de la
    decoupe, pas sur le dessin d'un glyphe — un bloc plein rend la mesure sure.
  */
  const mask: TextMask = { ...createTextMask('█'), duration: 10, ...patch };
  project = { ...project, textMasks: [mask] };

  const frames = new Map<string, FrameSource>([
    [asset.id, { image: bitmap, width: 256, height: 256 }],
  ]);

  return { project, cache: new StaticMediaCache(frames) };
}

function render(project: Project, cache: StaticMediaCache, time = 1): ImageData {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  draw(buildScene(project, time, cache), { ctx, width: WIDTH, height: HEIGHT });
  return ctx.getImageData(0, 0, WIDTH, HEIGHT);
}

/** Luminance d'un pixel, dans [0, 255]. */
function lumaAt(image: ImageData, x: number, y: number): number {
  const i = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return 0.2126 * image.data[i]! + 0.7152 * image.data[i + 1]! + 0.0722 * image.data[i + 2]!;
}

/** Luminance moyenne des quatre coins — toujours hors des lettres. */
function cornersLuma(image: ImageData): number {
  const inset = 4;
  return (
    (lumaAt(image, inset, inset) +
      lumaAt(image, WIDTH - inset, inset) +
      lumaAt(image, inset, HEIGHT - inset) +
      lumaAt(image, WIDTH - inset, HEIGHT - inset)) /
    4
  );
}

describe('masque texte', () => {
  it('laisse voir le clip DANS la lettre et couvre le reste', async () => {
    const { project, cache } = await projectWithMask();
    const image = render(project, cache);

    // Au centre, on est dans le bloc: le clip blanc doit transparaitre.
    expect(lumaAt(image, WIDTH / 2, HEIGHT / 2)).toBeGreaterThan(200);
    // Aux coins, le voile noir couvre tout.
    expect(cornersLuma(image)).toBeLessThan(20);
  });

  it('inverse la decoupe sur demande', async () => {
    /*
      Sens inverse: les lettres sont pleines, le reste laisse voir le montage.
      C'est exactement l'image complementaire — d'ou l'interet de la verifier,
      un bug de sens produisant l'une a la place de l'autre.
    */
    const { project, cache } = await projectWithMask({ inverted: true });
    const image = render(project, cache);

    expect(lumaAt(image, WIDTH / 2, HEIGHT / 2)).toBeLessThan(20);
    expect(cornersLuma(image)).toBeGreaterThan(200);
  });

  it('laisse transparaitre le montage selon le pourcentage demande', async () => {
    /*
      Le reglage de transparence: a 50 %, le voile noir laisse passer la moitie
      du clip blanc — donc un gris franc, ni noir ni blanc. C'est ce que le
      curseur de pourcentage doit produire.
    */
    const { project, cache } = await projectWithMask({ fillOpacity: 0.5 });
    const image = render(project, cache);

    const corners = cornersLuma(image);
    expect(corners).toBeGreaterThan(80);
    expect(corners).toBeLessThan(180);
  });

  it('garde les lettres pleinement decoupees malgre un voile transparent', () => {
    /*
      Piege: si la decoupe heritait de `fillOpacity`, elle ne retirerait qu'une
      partie du voile et les lettres resteraient grisees. Le reglage porte sur le
      VOILE, jamais sur la decoupe.
    */
    return projectWithMask({ fillOpacity: 0.5 }).then(({ project, cache }) => {
      const image = render(project, cache);
      expect(lumaAt(image, WIDTH / 2, HEIGHT / 2)).toBeGreaterThan(200);
    });
  });

  it('n apparait pas hors de sa fenetre de temps', async () => {
    const { project, cache } = await projectWithMask({ start: 2, duration: 1 });

    // Avant: le clip blanc est nu, donc la frame entiere est claire.
    expect(cornersLuma(render(project, cache, 1))).toBeGreaterThan(200);
    // Pendant: le voile couvre les coins.
    expect(cornersLuma(render(project, cache, 2.5))).toBeLessThan(20);
    // Apres: de nouveau nu.
    expect(cornersLuma(render(project, cache, 3.5))).toBeGreaterThan(200);
  });

  it('couvre toute la frame meme quand le texte est pivote', async () => {
    /*
      Le voile est peint AVANT la rotation, en coordonnees de frame. Pose apres,
      il pivoterait avec les lettres et decouvrirait les coins — un defaut qui
      n'apparait qu'a certains angles.
    */
    const { project, cache } = await projectWithMask({ rotation: 0.4 });
    expect(cornersLuma(render(project, cache))).toBeLessThan(20);
  });
});
