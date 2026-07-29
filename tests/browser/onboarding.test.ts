/**
 * L'enchainement de l'etape 3: analyse du rythme PUIS repartition des plans.
 *
 * La chaine traverse un worker (analyse), un `AudioContext` (decodage) et
 * IndexedDB (cache de beatmap): aucun n'existe sous Node, d'ou le projet
 * navigateur.
 *
 * On pilote les modules et le domaine, pas React: le projet n'embarque
 * deliberement aucune bibliotheque de rendu de test, et la valeur est dans la
 * chaine elle-meme, pas dans le JSX qui la declenche.
 */

import { describe, expect, it } from 'vitest';

import { analyzeAudio } from '@/audio/beatClient';
import { decodeAudioBlob } from '@/export/audioMix';
import { encodeWav, findGeneratedSample, renderSample } from '@/features/samples/sampleGen';
import { createAudioTrack, createClipForAsset, createEmptyProject } from '@/domain/project';
import { appendClip } from '@/domain/timeline';
import { distributeTrackOnBeats, timelineGrid } from '@/domain/snapping';
import type { MediaAsset, Project } from '@/domain/types';

/** Boucle generee au tempo connu a l'avance, donc verifiable. */
const SAMPLE_ID = 'gen-four-on-floor';

function imageAsset(id: string): MediaAsset {
  return {
    id,
    kind: 'image',
    name: `${id}.png`,
    mimeType: 'image/png',
    bytes: 512,
    storage: { backend: 'idb', key: `${id}.bin` },
    width: 100,
    height: 100,
    createdAt: Date.now(),
  };
}

/** Projet avec `clipCount` plans et une piste musicale. */
function projectWith(clipCount: number, audio: MediaAsset): Project {
  let project = createEmptyProject('Demarrage');
  const assets: Record<string, MediaAsset> = { [audio.id]: audio };

  for (let i = 0; i < clipCount; i += 1) {
    const image = imageAsset(`asset_img_${i}`);
    assets[image.id] = image;
    project = {
      ...project,
      videoTrack: appendClip(project.videoTrack, createClipForAsset(image), project.frame.fps),
    };
  }

  return {
    ...project,
    assets,
    audioTracks: [createAudioTrack(audio, 'music')],
  };
}

describe('demarrage en 3 etapes', () => {
  it('analyse une boucle generee puis repartit les plans sur les temps', async () => {
    const context = new AudioContext();
    const sample = findGeneratedSample(SAMPLE_ID);
    expect(sample).toBeDefined();

    // Etape 2: la boucle devient la musique du projet.
    const rendered = renderSample(sample!, context, 8);
    const blob = encodeWav(rendered);
    const buffer = await decodeAudioBlob(blob, context);

    const audio: MediaAsset = {
      id: 'asset_loop',
      kind: 'audio',
      name: 'loop.wav',
      mimeType: 'audio/wav',
      bytes: blob.size,
      storage: { backend: 'idb', key: 'loop.bin' },
      duration: buffer.duration,
      createdAt: Date.now(),
      sampleId: sample!.id,
    };

    const project = projectWith(4, audio);

    // Etape 3, premiere moitie: l'analyse.
    // `useCache: false` — un cache d'une execution precedente masquerait une
    // regression de l'analyse elle-meme.
    const beatMap = await analyzeAudio(audio.id, buffer, { useCache: false });
    expect(beatMap.beats.length).toBeGreaterThan(0);
    // La boucle est generee a un tempo connu: on doit le retrouver.
    expect(beatMap.bpm).toBeGreaterThan(sample!.bpm - 3);
    expect(beatMap.bpm).toBeLessThan(sample!.bpm + 3);

    // Etape 3, seconde moitie: la repartition, exactement comme le fait le
    // store dans `distributeOnBeats`.
    const grid = timelineGrid(beatMap, project.audioTracks[0], project.snapping.division);
    expect(grid.length).toBeGreaterThan(1);

    const distributed = distributeTrackOnBeats(project.videoTrack, grid, {
      division: project.snapping.division,
      mode: 'each',
      n: 1,
      fps: project.frame.fps,
    });

    // `beatLocked` est la preuve observable que la repartition a eu lieu, et
    // non un simple ripple qui aurait laisse les durees d'origine.
    for (const clip of distributed.clips) {
      expect(clip.beatLocked).toBe(true);
    }

    // Les plans occupent desormais un intervalle de grille chacun.
    const expected = grid[1]! - grid[0]!;
    for (const clip of distributed.clips) {
      expect(clip.duration).toBeCloseTo(expected, 1);
    }

    // Le montage reste contigu: c'est l'invariant de la piste video.
    let cursor = 0;
    for (const clip of distributed.clips) {
      expect(clip.start).toBeCloseTo(cursor, 6);
      cursor += clip.duration;
    }

    void context.close();
  }, 30_000);

  it('laisse les durees intactes quand la grille est trop courte', async () => {
    // Documente le mode d'echec « grille trop courte » de l'etape 3: la
    // repartition ne peut pas deduire d'intervalle a partir d'un seul point.
    const context = new AudioContext();
    const sample = findGeneratedSample(SAMPLE_ID)!;
    const rendered = renderSample(sample, context, 4);
    const blob = encodeWav(rendered);
    const buffer = await decodeAudioBlob(blob, context);

    const audio: MediaAsset = {
      id: 'asset_short',
      kind: 'audio',
      name: 'short.wav',
      mimeType: 'audio/wav',
      bytes: blob.size,
      storage: { backend: 'idb', key: 'short.bin' },
      duration: buffer.duration,
      createdAt: Date.now(),
    };

    const project = projectWith(2, audio);
    const before = project.videoTrack.clips.map((clip) => clip.duration);

    const distributed = distributeTrackOnBeats(project.videoTrack, [0], {
      division: project.snapping.division,
      mode: 'each',
      n: 1,
      fps: project.frame.fps,
    });

    expect(distributed.clips.map((clip) => clip.duration)).toEqual(before);

    void context.close();
  }, 30_000);
});
