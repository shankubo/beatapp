/**
 * Le surlignage karaoke doit etre DESSINE, et progresser.
 *
 * On mesure des pixels d'une couleur donnee sur un fond noir uni: tout pixel
 * chartreuse vient donc necessairement de la partie « chantee ». C'est la seule
 * verification qui prouve ce que l'utilisateur voit — un test sur `sungFraction`
 * seul ne dirait rien du rognage, de l'alignement ni du retour a la ligne.
 *
 * La progression traverse `lyricOverlays` -> `buildScene` -> `Compositor.draw`
 * -> `TextRenderer`, donc exactement le chemin de l'apercu ET de l'export.
 */

import { describe, expect, it } from 'vitest';

import { draw } from '@/engine/Compositor';
import { buildScene } from '@/engine/SceneGraph';
import { StaticMediaCache, type FrameSource } from '@/engine/MediaCache';
import { createEmptyProject, createLyrics, KARAOKE_SUNG_COLOR } from '@/domain/project';
import { appendClip } from '@/domain/timeline';
import type { LyricLine, MediaAsset, Project } from '@/domain/types';

async function blackBitmap(size = 256): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  return canvas.transferToImageBitmap();
}

function imageAsset(id: string): MediaAsset {
  return {
    id,
    kind: 'image',
    name: 'black.png',
    mimeType: 'image/png',
    bytes: 512,
    storage: { backend: 'idb', key: `${id}.bin` },
    width: 256,
    height: 256,
    createdAt: Date.now(),
  };
}

/** Projet d'un plan noir portant une seule ligne de paroles. */
async function projectWithLine(
  line: LyricLine,
  karaoke: boolean,
): Promise<{ project: Project; cache: StaticMediaCache }> {
  const bitmap = await blackBitmap();
  const asset = imageAsset('asset_black');

  let project = createEmptyProject('Karaoke');
  project = { ...project, assets: { [asset.id]: asset } };
  project = {
    ...project,
    videoTrack: appendClip(
      project.videoTrack,
      {
        id: 'clip_1',
        assetId: asset.id,
        start: 0,
        duration: 20,
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
      // Pas d'animation: on mesure le surlignage, pas un fondu.
      animation: { in: 'none', out: 'none', duration: 0 },
      // Blanc en attente: il contraste avec le chartreuse chante.
      style: { ...base.style, color: '#ffffff' },
      karaoke: { enabled: karaoke, color: KARAOKE_SUNG_COLOR },
      lines: [line],
    },
  };

  const frames = new Map<string, FrameSource>([
    [asset.id, { image: bitmap, width: 256, height: 256 }],
  ]);
  return { project, cache: new StaticMediaCache(frames) };
}

function render(project: Project, cache: StaticMediaCache, time: number): ImageData {
  const width = 360;
  const height = 640;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  draw(buildScene(project, time, cache), { ctx, width, height });
  return ctx.getImageData(0, 0, width, height);
}

/**
 * Compte les pixels proches du chartreuse (#e8ff3a = 232, 255, 58).
 *
 * Le critere exige que le VERT DOMINE LE ROUGE. Un premier essai se contentait
 * de « vert eleve, bleu faible » et comptait 144 pixels alors que le karaoke
 * etait desactive: l'antialiasing sous-pixel du texte blanc produit des franges
 * orangees (mesurees a 239,191,111) qui satisfaisaient ce critere. Le chartreuse,
 * lui, a toujours plus de vert que de rouge.
 */
function sungPixels(image: ImageData): number {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i]!;
    const g = image.data[i + 1]!;
    const b = image.data[i + 2]!;
    if (g > 150 && g > r + 15 && g > b + 80) count += 1;
  }
  return count;
}

/** Compte les pixels quasi blancs: la partie encore en attente. */
function pendingPixels(image: ImageData): number {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i]!;
    const g = image.data[i + 1]!;
    const b = image.data[i + 2]!;
    if (r > 200 && g > 200 && b > 200) count += 1;
  }
  return count;
}

/** Ligne de 4 s avec quatre mots d'une seconde chacun, de meme longueur. */
const TIMED_LINE: LyricLine = {
  id: 'lyric_1',
  text: 'AAAA BBBB CCCC DDDD',
  start: 2,
  duration: 4,
  words: [
    { text: 'AAAA', start: 2, end: 3 },
    { text: 'BBBB', start: 3, end: 4 },
    { text: 'CCCC', start: 4, end: 5 },
    { text: 'DDDD', start: 5, end: 6 },
  ],
};

describe('surlignage karaoke', () => {
  it('ne peint rien de chante avant le debut de la ligne', async () => {
    const { project, cache } = await projectWithLine(TIMED_LINE, true);
    // Juste apres le debut, une fraction infime est chantee: on regarde AVANT.
    const before = render(project, cache, 1.5);
    expect(sungPixels(before)).toBe(0);
  });

  it('peint toute la ligne quand elle est terminee', async () => {
    const { project, cache } = await projectWithLine(TIMED_LINE, true);
    /**
     * Instant delicat, etabli par la mesure.
     *
     * La ligne court de 2 a 6 s et son dernier mot finit a 6. Il faut donc
     * echantillonner DANS la ligne mais APRES le dernier mot: a 5,95 il reste
     * une fraction non chantee (correct), et a 6,5 l'incrustation n'est plus
     * rendue du tout — deux erreurs que les versions precedentes de ce test ont
     * commises tour a tour.
     */
    const atEnd = render(project, cache, 5.999);
    expect(sungPixels(atEnd)).toBeGreaterThan(0);
    // Plus aucun pixel en couleur d'attente: le surlignage couvre tout le texte.
    expect(pendingPixels(atEnd)).toBe(0);
  });

  it('laisse la fin du dernier mot en attente juste avant la fin', async () => {
    const { project, cache } = await projectWithLine(TIMED_LINE, true);
    // Contre-epreuve du test precedent: a 99 % de progression, une petite
    // portion doit encore etre en attente. Sinon le front « sauterait » a 100 %
    // avant l'heure, et le karaoke devancerait le chant.
    const nearEnd = render(project, cache, 5.95);
    expect(pendingPixels(nearEnd)).toBeGreaterThan(0);
  });

  it('progresse de gauche a droite au fil du temps', async () => {
    const { project, cache } = await projectWithLine(TIMED_LINE, true);

    const quarter = sungPixels(render(project, cache, 3));
    const half = sungPixels(render(project, cache, 4));
    const threeQuarters = sungPixels(render(project, cache, 5));

    // La surface chantee croit strictement: c'est la preuve du balayage.
    expect(quarter).toBeGreaterThan(0);
    expect(half).toBeGreaterThan(quarter);
    expect(threeQuarters).toBeGreaterThan(half);
  });

  it('laisse le reste de la ligne en couleur d attente', async () => {
    const { project, cache } = await projectWithLine(TIMED_LINE, true);
    // A mi-parcours, les DEUX couleurs coexistent — c'est tout l'effet karaoke.
    const middle = render(project, cache, 4);
    expect(sungPixels(middle)).toBeGreaterThan(0);
    expect(pendingPixels(middle)).toBeGreaterThan(0);
  });

  it('ne peint rien de chante quand le karaoke est desactive', async () => {
    const { project, cache } = await projectWithLine(TIMED_LINE, false);
    const middle = render(project, cache, 4);
    expect(sungPixels(middle)).toBe(0);
    // Le texte reste bien affiche, simplement d'une seule couleur.
    expect(pendingPixels(middle)).toBeGreaterThan(0);
  });

  it('balaye aussi une ligne SANS mots horodates', async () => {
    // Paroles collees ou fichier .lrc: la progression suit la duree.
    const plain: LyricLine = { id: 'lyric_2', text: 'AAAA BBBB CCCC', start: 2, duration: 4 };
    const { project, cache } = await projectWithLine(plain, true);

    const early = sungPixels(render(project, cache, 2.6));
    const late = sungPixels(render(project, cache, 5.4));
    expect(late).toBeGreaterThan(early);
  });
});
