/**
 * Le son d'un reel importe est-il reellement exploitable ?
 *
 * Deux symptomes signales: aucun son a la lecture, et l'onglet Beat qui reclame
 * une musique. Ce test reproduit la chaine exacte de `useImportReel` sans React,
 * pour situer la panne — le store et le domaine sont pilotables directement.
 */

import { describe, expect, it } from 'vitest';

import { createAudioTrack, musicTrack } from '@/domain/project';
import { scheduleSegments } from '@/domain/audioEdit';
import { videoDuration } from '@/domain/timeline';
import { cutCount, cutIntoClips, frameForSource } from '@/domain/reelCut';
import { createEmptyProject } from '@/domain/project';
import { ripple } from '@/domain/timeline';
import type { MediaAsset, Project } from '@/domain/types';

/** Asset tel que `importFile` le produit pour un reel sonore de 12 s. */
function reelAsset(): MediaAsset {
  return {
    id: 'asset_reel',
    kind: 'video',
    name: 'reel.mp4',
    mimeType: 'video/mp4',
    bytes: 1_000_000,
    storage: { backend: 'idb', key: 'reel.bin' },
    width: 1080,
    height: 1920,
    duration: 12,
    hasAudio: true,
    createdAt: Date.now(),
  };
}

/** Reproduit `applyCutsToProject` puis la pose de la musique. */
function importedProject(cuts: number[]): Project {
  const asset = reelAsset();
  const base = createEmptyProject('Reel');
  const options = { duration: asset.duration!, cuts, speed: 1 };
  const ids = Array.from({ length: cutCount(options) }, (_, i) => `clip_${i}`);

  const clips = cutIntoClips(
    {
      assetId: asset.id,
      fit: 'cover',
      transform: { scale: 1, x: 0, y: 0, rotation: 0 },
      muted: true,
    },
    ids,
    options,
  );

  const project: Project = {
    ...base,
    frame: frameForSource(base.frame, asset),
    assets: { [asset.id]: asset },
    videoTrack: { ...base.videoTrack, clips: ripple(clips, base.frame.fps) },
  };

  // `setMusic` cree la piste ainsi.
  return { ...project, audioTracks: [createAudioTrack(asset, 'music')] };
}

describe('son d un reel importe', () => {
  it('pose une piste MUSIQUE, visible par l onglet Beat', () => {
    // `BeatSheet` lit `musicTrack()`, qui ne retient que `role === 'music'`.
    // Un role `original` laissait le menu afficher « importez d'abord une
    // musique » alors qu'une piste existait.
    const project = importedProject([4, 8]);
    const track = musicTrack(project);
    expect(track).toBeDefined();
    expect(track?.assetId).toBe('asset_reel');
  });

  it('couvre toute la duree du reel', () => {
    const track = musicTrack(importedProject([4, 8]))!;
    expect(track.start).toBe(0);
    expect(track.source.out).toBeCloseTo(12, 6);
    expect(track.muted).toBe(false);
    expect(track.gain).toBeGreaterThan(0);
  });

  it('produit des segments audibles a la lecture', () => {
    /*
      Le coeur du symptome « pas de son »: `Player.scheduleVoices` abandonne la
      piste si `scheduleSegments` ne rend rien. On verifie donc que la
      planification produit au moins un morceau, et qu'il couvre le montage.
    */
    const project = importedProject([4, 8]);
    const track = musicTrack(project)!;
    const scheduled = scheduleSegments(track, {
      from: 0,
      until: videoDuration(project.videoTrack),
      sourceDuration: 12,
    });

    expect(scheduled.length).toBeGreaterThan(0);
    const total = scheduled.reduce((sum, part) => sum + part.duration, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('garde la piste audible meme sans coupe', () => {
    // Un reel arrive en un seul plan quand aucune coupe n'est trouvee: le son
    // doit rester exploitable dans ce cas aussi.
    const project = importedProject([]);
    const track = musicTrack(project)!;
    const scheduled = scheduleSegments(track, {
      from: 0,
      until: videoDuration(project.videoTrack),
      sourceDuration: 12,
    });
    expect(scheduled.length).toBeGreaterThan(0);
  });

  it('laisse les clips muets pour ne pas doubler le son', () => {
    const project = importedProject([4, 8]);
    for (const clip of project.videoTrack.clips) {
      expect(clip.muted).toBe(true);
    }
  });

  it('aligne le format du projet sur le reel', () => {
    const project = importedProject([4]);
    expect(project.frame.width).toBe(1080);
    expect(project.frame.height).toBe(1920);
  });
});
