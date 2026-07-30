/**
 * Le cadenas d'une piste doit REELLEMENT bloquer toute modification.
 *
 * Bug corrige: le verrou n'etait controle que par trois actions (`removeClip`,
 * `splitAtPlayhead`, `removeText`). Tout le reste passait au travers — on
 * pouvait deplacer un plan, le rogner, changer sa duree, le dupliquer, poser un
 * filtre, supprimer une piste audio ou decaler la musique sur une piste pourtant
 * verrouillee.
 *
 * Un cadenas qui n'empeche qu'un dixieme des modifications est pire qu'aucun
 * cadenas: il promet une protection qu'il n'assure pas. D'ou ce test, qui
 * verrouille puis tente CHAQUE action et exige que le projet reste identique.
 *
 * Il tourne dans un navigateur parce que le store entraine `usePreferencesStore`
 * et son `localStorage`.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { useProjectStore } from '@/store/useProjectStore';
import { createEmptyProject, filterForPreset } from '@/domain/project';
import type { MediaAsset, Project } from '@/domain/types';

const image: MediaAsset = {
  id: 'asset_img',
  kind: 'image',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  bytes: 1000,
  storage: { backend: 'idb', key: 'asset_img' },
  width: 1080,
  height: 1920,
  createdAt: 0,
};

const audio: MediaAsset = {
  id: 'asset_snd',
  kind: 'audio',
  name: 'musique.mp3',
  mimeType: 'audio/mpeg',
  bytes: 2000,
  storage: { backend: 'idb', key: 'asset_snd' },
  duration: 30,
  createdAt: 0,
};

/** Projet de depart: deux plans et une musique. */
function seed(): Project {
  const store = useProjectStore.getState();
  store.replaceProject(createEmptyProject('Test'));
  store.addAssetToTimeline(image);
  store.addAssetToTimeline({ ...image, id: 'asset_img2' });
  store.setMusic(audio);
  return useProjectStore.getState().project;
}

/** Etat comparable: on ignore `updatedAt`, qui bouge a chaque `touched`. */
function snapshot(project: Project): string {
  const { updatedAt: _ignored, ...rest } = project;
  return JSON.stringify(rest);
}

describe('verrou de la piste image', () => {
  beforeEach(() => {
    seed();
    useProjectStore.getState().setTrackLocked('video', true);
  });

  it('refuse toute modification des plans', () => {
    const store = useProjectStore.getState();
    const clip = store.project.videoTrack.clips[0]!;
    const before = snapshot(store.project);

    // Chaque action est tentee sur une piste verrouillee.
    store.removeClip(clip.id);
    store.moveClip(0, 1);
    store.setClipDuration(clip.id, 5);
    store.trimStart(clip.id, 0.5);
    store.trimEnd(clip.id, -0.5);
    store.updateClip(clip.id, { transform: { ...clip.transform, scale: 3 } });
    store.duplicateClip(clip.id);
    store.setClipFilter(clip.id, filterForPreset('noir'));
    store.setFilterPreset(clip.id, 'vivid');
    store.replaceClipAsset(clip.id, { ...image, id: 'autre' });

    expect(snapshot(useProjectStore.getState().project)).toBe(before);
  });

  it('laisse deverrouiller, puis modifier', () => {
    const store = useProjectStore.getState();
    const clip = store.project.videoTrack.clips[0]!;

    // Le verrou ne doit pas se verrouiller lui-meme.
    store.setTrackLocked('video', false);
    useProjectStore.getState().setClipDuration(clip.id, 5);

    const after = useProjectStore.getState().project.videoTrack.clips[0]!;
    expect(after.duration).toBeCloseTo(5, 3);
  });
});

describe('verrou d’une piste audio', () => {
  let trackId: string;

  beforeEach(() => {
    const project = seed();
    trackId = project.audioTracks[0]!.id;
    useProjectStore.getState().setAudioTrackFlags(trackId, { locked: true });
  });

  it('refuse toute modification de la piste', () => {
    const store = useProjectStore.getState();
    const before = snapshot(store.project);

    store.updateAudioTrack(trackId, { gain: 0.1 });
    store.setAudioOffset(trackId, 4);
    store.setAudioRange(trackId, { in: 1, out: 10 });
    store.removeAudioRange(trackId, 2, 3);
    store.splitAudio(trackId, 5);
    store.removeAudioTrack(trackId);

    expect(snapshot(useProjectStore.getState().project)).toBe(before);
  });

  it('laisse deverrouiller la piste', () => {
    const store = useProjectStore.getState();
    store.setAudioTrackFlags(trackId, { locked: false });
    useProjectStore.getState().updateAudioTrack(trackId, { gain: 0.25 });

    const track = useProjectStore
      .getState()
      .project.audioTracks.find((t) => t.id === trackId);
    expect(track?.gain).toBeCloseTo(0.25, 3);
  });
});

describe('verrou de la piste texte', () => {
  beforeEach(() => {
    seed();
    useProjectStore.getState().addText('bonjour', { start: 0 });
    useProjectStore.getState().setTrackLocked('text', true);
  });

  it('refuse toute modification du texte', () => {
    const store = useProjectStore.getState();
    const overlayId = store.project.overlays[0]!.id;
    const before = snapshot(store.project);

    store.addText('encore', { start: 0 });
    store.updateText(overlayId, { text: 'modifie' });
    store.removeText(overlayId);
    store.setLyricsFromText('une ligne', { startAt: 0 });
    store.clearLyrics();

    expect(snapshot(useProjectStore.getState().project)).toBe(before);
  });
});
