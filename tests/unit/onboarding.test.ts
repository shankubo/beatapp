/**
 * Logique de l'ecran de demarrage.
 *
 * Le cas le plus precieux de ce fichier est celui qui verifie qu'un changement
 * de musique ramene l'etape 3 a `idle`: `setMusic` efface `beatMap`, et une
 * carte qui resterait cochee promettrait une analyse qui n'existe plus.
 */

import { describe, expect, it } from 'vitest';

import { deriveSteps, isProjectEmpty } from '@/features/onboarding/onboardingState';
import { createAudioTrack, createClipForAsset, createEmptyProject } from '@/domain/project';
import { appendClip } from '@/domain/timeline';
import { BEAT_ALGO_VERSION, type BeatMap, type MediaAsset, type Project } from '@/domain/types';

function imageAsset(id = 'asset_img'): MediaAsset {
  return {
    id,
    kind: 'image',
    name: 'photo.png',
    mimeType: 'image/png',
    bytes: 1024,
    storage: { backend: 'idb', key: `${id}.bin` },
    width: 100,
    height: 100,
    createdAt: Date.now(),
  };
}

function audioAsset(id = 'asset_audio'): MediaAsset {
  return {
    id,
    kind: 'audio',
    name: 'loop.wav',
    mimeType: 'audio/wav',
    bytes: 2048,
    storage: { backend: 'idb', key: `${id}.bin` },
    duration: 30,
    createdAt: Date.now(),
  };
}

function beatMapFor(assetId: string): BeatMap {
  return {
    assetId,
    beats: [0, 0.5, 1, 1.5],
    strength: [1, 0.8, 1, 0.8],
    bpm: 120,
    confidence: 0.9,
    barOffset: 0,
    beatsPerBar: 4,
    analyzedAt: Date.now(),
    algoVersion: BEAT_ALGO_VERSION,
  };
}

/** Projet avec un clip, une musique, et eventuellement une analyse. */
function fullProject(options: { withBeatMap?: boolean } = {}): Project {
  const image = imageAsset();
  const audio = audioAsset();

  let project = createEmptyProject('Test');
  project = { ...project, assets: { [image.id]: image, [audio.id]: audio } };
  project = {
    ...project,
    videoTrack: appendClip(project.videoTrack, createClipForAsset(image), project.frame.fps),
    audioTracks: [createAudioTrack(audio, 'music')],
  };

  return options.withBeatMap ? { ...project, beatMap: beatMapFor(audio.id) } : project;
}

describe('isProjectEmpty', () => {
  it('reconnait un projet neuf', () => {
    expect(isProjectEmpty(createEmptyProject('Neuf'))).toBe(true);
  });

  // Les trois clauses sont testees separement: c'est le genre de predicat dont
  // une clause saute au refactor sans que rien ne le signale.
  it('est faux avec un seul media importe', () => {
    const asset = imageAsset();
    const project = { ...createEmptyProject('X'), assets: { [asset.id]: asset } };
    expect(isProjectEmpty(project)).toBe(false);
  });

  it('est faux avec un seul clip', () => {
    const asset = imageAsset();
    const base = createEmptyProject('X');
    const project = {
      ...base,
      videoTrack: appendClip(base.videoTrack, createClipForAsset(asset), base.frame.fps),
    };
    expect(isProjectEmpty(project)).toBe(false);
  });

  it('est faux avec une seule piste audio', () => {
    const base = createEmptyProject('X');
    const project = { ...base, audioTracks: [createAudioTrack(audioAsset(), 'music')] };
    expect(isProjectEmpty(project)).toBe(false);
  });
});

describe('deriveSteps', () => {
  it('part de zero sur un projet vide', () => {
    const steps = deriveSteps(createEmptyProject('Neuf'), null);
    expect(steps.media).toBe('idle');
    expect(steps.audio).toBe('idle');
    // Sans musique, il n'y a rien a analyser.
    expect(steps.beat).toBe('disabled');
  });

  it('coche l etape media des qu un clip existe', () => {
    const asset = imageAsset();
    const base = createEmptyProject('X');
    const project = {
      ...base,
      videoTrack: appendClip(base.videoTrack, createClipForAsset(asset), base.frame.fps),
    };
    expect(deriveSteps(project, null).media).toBe('done');
  });

  it('active l etape rythme des qu une musique est posee', () => {
    const steps = deriveSteps(fullProject(), null);
    expect(steps.audio).toBe('done');
    expect(steps.beat).toBe('idle');
  });

  it('coche l etape rythme une fois l analyse faite', () => {
    expect(deriveSteps(fullProject({ withBeatMap: true }), null).beat).toBe('done');
  });

  it('ramene l etape rythme a idle quand la musique change', () => {
    // `setMusic` efface `beatMap`: c'est exactement ce que ce test protege.
    // Une carte restee cochee promettrait une analyse disparue.
    const analyzed = fullProject({ withBeatMap: true });
    expect(deriveSteps(analyzed, null).beat).toBe('done');

    const afterMusicChange: Project = { ...analyzed, beatMap: undefined };
    expect(deriveSteps(afterMusicChange, null).beat).toBe('idle');
  });

  it('reste actif sans clip: la repartition previendra elle-meme', () => {
    // L'absence de clip ne desactive PAS l'etape 3, sinon l'utilisateur n'aurait
    // aucune explication. Le garde-fou et son message sont dans l'appelant.
    const audio = audioAsset();
    const base = createEmptyProject('X');
    const project = {
      ...base,
      assets: { [audio.id]: audio },
      audioTracks: [createAudioTrack(audio, 'music')],
    };
    expect(deriveSteps(project, null).beat).toBe('idle');
  });

  it('affiche l occupation sur la seule etape concernee', () => {
    const project = fullProject({ withBeatMap: true });
    const steps = deriveSteps(project, 'beat');

    // `busy` l'emporte sur `done` pour son etape...
    expect(steps.beat).toBe('busy');
    // ...et laisse les autres inchangees.
    expect(steps.media).toBe('done');
    expect(steps.audio).toBe('done');
  });

  it('affiche l occupation meme sur une etape par ailleurs desactivee', () => {
    const steps = deriveSteps(createEmptyProject('Neuf'), 'audio');
    expect(steps.audio).toBe('busy');
    expect(steps.beat).toBe('disabled');
  });
});
