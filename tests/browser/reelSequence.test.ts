/**
 * Sonde: la SEQUENCE reelle de `useImportReel` contre le vrai store.
 *
 * Le modele est correct et le decodage aussi. Restait l'enchainement des
 * mutations, qui n'avait ete verifie par aucun test. On le rejoue ici pas a
 * pas, en inspectant le store apres chaque etape.
 */

import { describe, expect, it } from 'vitest';

import { useProjectStore } from '@/store/useProjectStore';
import { musicTrack } from '@/domain/project';
import { cutCount, cutIntoClips, frameForSource } from '@/domain/reelCut';
import { ripple } from '@/domain/timeline';
import type { MediaAsset } from '@/domain/types';

function reelAsset(): MediaAsset {
  return {
    id: 'asset_reel_seq',
    kind: 'video',
    name: 'reel.mp4',
    mimeType: 'video/mp4',
    bytes: 1_000_000,
    storage: { backend: 'idb', key: 'reel_seq.bin' },
    width: 1080,
    height: 1920,
    duration: 12,
    hasAudio: true,
    createdAt: Date.now(),
  };
}

/** Copie conforme de `applyCutsToProject`. */
function applyCuts(asset: MediaAsset, cuts: number[]): void {
  const store = useProjectStore.getState();
  const project = store.project;
  const options = { duration: asset.duration ?? 0, cuts, speed: 1 };
  const ids = Array.from({ length: cutCount(options) }, (_, i) => `c_${i}`);

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

  store.replaceProject({
    ...project,
    frame: frameForSource(project.frame, asset),
    assets: { ...project.assets, [asset.id]: asset },
    videoTrack: { ...project.videoTrack, clips: ripple(clips, project.frame.fps) },
  });
}

describe('sequence d import d un reel', () => {
  it('laisse une piste musique dans le store a la fin', () => {
    const asset = reelAsset();
    useProjectStore.getState().newProject('Test');

    // 1. decoupage
    applyCuts(asset, [4, 8]);
    expect(useProjectStore.getState().project.videoTrack.clips.length).toBe(3);

    // 2. musique
    useProjectStore.getState().setMusic(asset);

    const project = useProjectStore.getState().project;
    const track = musicTrack(project);

    expect(track, 'aucune piste musique dans le store').toBeDefined();
    // L'asset doit etre present, sinon aucun buffer ne sera cherche.
    expect(project.assets[asset.id], 'asset absent du projet').toBeDefined();
    expect(track?.muted).toBe(false);
    expect(track?.source.out).toBeCloseTo(12, 6);
  });

  it('conserve la piste musique quand le decoupage vient APRES', () => {
    /*
      Ordre inverse, pour situer la panne: si poser la musique PUIS decouper
      efface la piste, c'est `replaceProject` qui la perd — il reecrit le projet
      a partir d'un instantane pris avant.
    */
    const asset = reelAsset();
    useProjectStore.getState().newProject('Test');

    useProjectStore.getState().setMusic(asset);
    expect(musicTrack(useProjectStore.getState().project)).toBeDefined();

    applyCuts(asset, [4, 8]);

    const track = musicTrack(useProjectStore.getState().project);
    expect(track, 'la piste musique a disparu apres le decoupage').toBeDefined();
  });
});
