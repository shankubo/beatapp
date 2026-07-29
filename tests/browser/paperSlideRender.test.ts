/**
 * Geometrie des glissements de calque, mesuree en PIXELS.
 *
 * Les tests unitaires de `transitions.ts` verifient la courbe, mais ce module
 * est pur: il dit *ou en est* le voile, jamais *ou* il tombe dans la frame.
 * Toute la traduction « fraction -> rectangle » vit dans `Compositor`, et un
 * sens inverse par erreur y passerait sans qu'aucun test unitaire ne bronche —
 * les quatre sens produisent exactement le meme `progress`.
 *
 * On mesure donc ce que l'utilisateur voit: quel COTE de la frame est encore
 * couvert par le voile blanc a mi-transition.
 */

import { describe, expect, it } from 'vitest';

import { draw } from '@/engine/Compositor';
import { buildScene } from '@/engine/SceneGraph';
import { StaticMediaCache, type FrameSource } from '@/engine/MediaCache';
import { createEmptyProject } from '@/domain/project';
import { appendClip } from '@/domain/timeline';
import type { MediaAsset, Project, TransitionAccent, TransitionType } from '@/domain/types';

const TRANSITION_DURATION = 1;
const CLIP_DURATION = 4;

/** Deux plans NOIRS: tout apport de blanc vient donc du voile. */
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

/** Deux plans qui se suivent, le second portant la transition testee. */
async function projectWithTransition(
  type: TransitionType,
  accent?: TransitionAccent,
): Promise<{ project: Project; cache: StaticMediaCache }> {
  const bitmap = await blackBitmap();
  const asset = imageAsset('asset_black', bitmap.width, bitmap.height);

  let project = createEmptyProject('Calque');
  project = { ...project, assets: { [asset.id]: asset } };

  for (const id of ['clip_1', 'clip_2']) {
    project = {
      ...project,
      videoTrack: appendClip(
        project.videoTrack,
        {
          id,
          assetId: asset.id,
          start: 0,
          duration: CLIP_DURATION,
          fit: 'cover',
          transform: { scale: 1, x: 0, y: 0, rotation: 0 },
          muted: false,
          ...(id === 'clip_2'
            ? {
                transitionIn: {
                  type,
                  duration: TRANSITION_DURATION,
                  ...(accent ? { accent } : {}),
                },
              }
            : {}),
        },
        project.frame.fps,
      ),
    };
  }

  const frames = new Map<string, FrameSource>([
    [asset.id, { image: bitmap, width: bitmap.width, height: bitmap.height }],
  ]);

  return { project, cache: new StaticMediaCache(frames) };
}

const WIDTH = 240;
const HEIGHT = 400;

function render(project: Project, cache: StaticMediaCache, time: number): ImageData {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  draw(buildScene(project, time, cache), { ctx, width: WIDTH, height: HEIGHT });
  return ctx.getImageData(0, 0, WIDTH, HEIGHT);
}

/** Luminance moyenne d'une bande rectangulaire, dans [0, 255]. */
function bandLuma(
  image: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  let sum = 0;
  let count = 0;
  for (let y = Math.floor(y0); y < Math.floor(y1); y += 1) {
    for (let x = Math.floor(x0); x < Math.floor(x1); x += 1) {
      const i = (y * image.width + x) * 4;
      sum += 0.2126 * image.data[i]! + 0.7152 * image.data[i + 1]! + 0.0722 * image.data[i + 2]!;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

/*
  Bandes ECHANTILLONNEES loin du bord et du trait.

  A mi-transition le bord est au centre; on lit donc a un quart et trois quarts,
  ce qui laisse un quart de frame de marge de chaque cote. Mesurer contre le bord
  ferait dependre le test de l'anticrenelage et de l'epaisseur du trait.
*/
const QUARTERS = {
  left: (img: ImageData) => bandLuma(img, 0, 0, WIDTH * 0.25, HEIGHT),
  right: (img: ImageData) => bandLuma(img, WIDTH * 0.75, 0, WIDTH, HEIGHT),
  top: (img: ImageData) => bandLuma(img, 0, 0, WIDTH, HEIGHT * 0.25),
  bottom: (img: ImageData) => bandLuma(img, 0, HEIGHT * 0.75, WIDTH, HEIGHT),
};

describe('glissement de calque — geometrie rendue', () => {
  /*
    Le voile fuit vers `direction`, donc a mi-course il a quitte ce cote et
    couvre encore le cote OPPOSE. C'est la seule assertion qui distingue
    reellement les quatre sens: `progress` est identique pour tous.
  */
  const CASES = [
    { type: 'paperSlideLeft', cleared: 'left', covered: 'right' },
    { type: 'paperSlideRight', cleared: 'right', covered: 'left' },
    { type: 'paperSlideUp', cleared: 'top', covered: 'bottom' },
    { type: 'paperSlideDown', cleared: 'bottom', covered: 'top' },
  ] as const;

  for (const { type, cleared, covered } of CASES) {
    it(`degage le cote ${cleared} avant le cote ${covered} (${type})`, async () => {
      const { project, cache } = await projectWithTransition(type);
      // Mi-transition: le second plan demarre a CLIP_DURATION.
      const image = render(project, cache, CLIP_DURATION + TRANSITION_DURATION / 2);

      const clearedLuma = QUARTERS[cleared](image);
      const coveredLuma = QUARTERS[covered](image);

      // Les plans sont noirs: le cote degage doit etre nettement plus sombre.
      expect(coveredLuma, `${type} — cote couvert`).toBeGreaterThan(clearedLuma + 40);
      // Et le cote couvert doit bien porter un voile a ~50 % de blanc, pas un
      // aplat opaque qui masquerait l'image au lieu de la laisser deviner.
      expect(coveredLuma, `${type} — voile a moitie transparent`).toBeLessThan(200);
    });
  }

  it('ne laisse aucun voile une fois la transition terminee', async () => {
    /*
      Le defaut que cet invariant attrape: un voile qui resterait pose sur le
      plan bien apres la transition. Les plans etant noirs, la frame doit l'etre
      aussi — le moindre reste de blanc se voit.
    */
    for (const { type } of CASES) {
      const { project, cache } = await projectWithTransition(type);
      const image = render(project, cache, CLIP_DURATION + TRANSITION_DURATION + 0.5);
      for (const band of Object.values(QUARTERS)) {
        expect(band(image), type).toBeLessThan(2);
      }
    }
  });

  it('couvre toute la frame au tout debut de la transition', async () => {
    // Le point de depart decrit: « l'image suivante couverte par un blanc
    // transparent ». Les quatre cotes doivent donc etre voiles ensemble.
    for (const { type } of CASES) {
      const { project, cache } = await projectWithTransition(type);
      const image = render(project, cache, CLIP_DURATION + 0.01);
      for (const [name, band] of Object.entries(QUARTERS)) {
        expect(band(image), `${type} — ${name}`).toBeGreaterThan(80);
      }
    }
  });
});

describe('accent cumule — rendu reel', () => {
  /*
    Le cumul demande par l'utilisateur: « Tremblement ET Calque ».

    Les tests unitaires verifient que les canaux s'additionnent, mais c'est ici
    qu'on constate que les DEUX effets arrivent bien jusqu'aux pixels: le voile
    du calque doit rester visible et garder son cote, malgre la secousse.
  */
  it('retarde le depart du calque par rapport a un jeu simultane', async () => {
    /*
      Le test qui separe REELLEMENT l'enchainement du cumul simultane.

      Piege mesure en ecrivant ce test: comparer les deux modes tot dans la
      transition ne prouve rien. `easeInOutCubic` demarre si lentement qu'a
      t = 0,28 un calque simultane n'a parcouru que 8,8 % de la frame — les deux
      modes couvrent alors le meme quart gauche, et un test pose la passait meme
      en desactivant la phase d'accent. Verifie en la neutralisant exprès.

      C'est a MI-TRANSITION que l'ecart est franc: 6 % de course en enchaine
      contre 50 % en simultane. Le quart gauche doit donc etre encore couvert
      avec accent, et deja degage sans lui.
    */
    const plain = await projectWithTransition('paperSlideLeft');
    const shaken = await projectWithTransition('paperSlideLeft', 'shake');
    const at = CLIP_DURATION + TRANSITION_DURATION / 2;

    const plainLeft = QUARTERS.left(render(plain.project, plain.cache, at));
    const shakenLeft = QUARTERS.left(render(shaken.project, shaken.cache, at));

    // Sans accent, le voile a deja libere la gauche: elle est sombre.
    expect(plainLeft).toBeLessThan(40);
    // Avec accent, le calque attend encore: la gauche reste voilee.
    expect(shakenLeft).toBeGreaterThan(80);
  });

  it('degage ensuite le calque, image nette a la cle', async () => {
    /*
      Seconde phase: le tremblement est passe, le voile part vers la gauche et
      l'image se decouvre. C'est le « on commence a voir l'image nette » demande.

      On echantillonne apres la bascule (1/3) et avant la fin, la ou le voile est
      a mi-course: la gauche est degagee, la droite encore couverte.
    */
    const { project, cache } = await projectWithTransition('paperSlideLeft', 'shake');
    const image = render(project, cache, CLIP_DURATION + TRANSITION_DURATION * (1 / 3 + 1 / 3));

    expect(QUARTERS.right(image)).toBeGreaterThan(QUARTERS.left(image) + 40);
    // Le voile garde sa demi-transparence: il laisse deviner l'image dessous.
    expect(QUARTERS.right(image)).toBeLessThan(200);
  });

  it('ne fait pas clignoter le plan au debut du cumul', async () => {
    /*
      Le piege que ce test verrouille cote pixels: joue seul, `shake` porte son
      propre fondu d'entree. Si l'opacite se multipliait, les premieres frames
      d'un « Calque + Tremblement » seraient sombres — le fond noir
      transparaissant sous un plan a demi efface — alors que le calque veut une
      image PLEINE des le debut.

      Le voile blanc couvrant tout a t = 0, la frame doit etre CLAIRE.
    */
    const { project, cache } = await projectWithTransition('paperSlideLeft', 'shake');
    const image = render(project, cache, CLIP_DURATION + 0.02);
    for (const [name, band] of Object.entries(QUARTERS)) {
      expect(band(image), name).toBeGreaterThan(80);
    }
  });

  it('ne laisse aucun residu une fois le cumul termine', async () => {
    // Deux effets cumules, ce sont deux residus possibles: un decalage restant
    // et une secousse non amortie s'additionneraient.
    for (const accent of ['shake', 'glitch', 'flash'] as const) {
      const { project, cache } = await projectWithTransition('paperSlideLeft', accent);
      const image = render(project, cache, CLIP_DURATION + TRANSITION_DURATION + 0.5);
      for (const band of Object.values(QUARTERS)) {
        expect(band(image), accent).toBeLessThan(2);
      }
    }
  });
});
