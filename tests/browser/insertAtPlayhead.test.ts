/**
 * Un media importe se pose OU EST LA TETE DE LECTURE, pas en fin de piste.
 *
 * Bug corrige: tout import atterrissait a la fin, quelle que soit la position
 * du trait. Poser un plan au milieu d'un montage imposait de l'ajouter puis de
 * le remonter a la main, coupure par coupure.
 *
 * Le second test verrouille l'ordre d'un LOT: un import multiple boucle sur la
 * meme action, et si chaque appel visait le meme rang les fichiers arriveraient
 * a l'envers.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { useProjectStore } from '@/store/useProjectStore';
import { usePlaybackStore } from '@/store/usePlaybackStore';
import { createEmptyProject } from '@/domain/project';
import type { MediaAsset } from '@/domain/types';

function image(id: string): MediaAsset {
  return {
    id,
    kind: 'image',
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    bytes: 1000,
    storage: { backend: 'idb', key: id },
    width: 1080,
    height: 1920,
    createdAt: 0,
  };
}

/** Noms des plans dans l'ordre de la piste. */
function ordre(): string[] {
  const { project } = useProjectStore.getState();
  return project.videoTrack.clips.map((clip) => clip.assetId);
}

describe('insertion a la tete de lecture', () => {
  beforeEach(() => {
    useProjectStore.getState().replaceProject(createEmptyProject('Test'));
    usePlaybackStore.getState().setTime(0);
  });

  it('ajoute a la fin quand la piste est vide', () => {
    useProjectStore.getState().addAssetToTimeline(image('a'));
    expect(ordre()).toEqual(['a']);
  });

  it('insere APRES le plan traverse par la tete', () => {
    const store = useProjectStore.getState();
    store.addAssetToTimeline(image('a'));
    store.addAssetToTimeline(image('b'));
    store.addAssetToTimeline(image('c'));
    expect(ordre()).toEqual(['a', 'b', 'c']);

    // Chaque plan dure 2 s par defaut: 2,5 s tombe dans le deuxieme.
    usePlaybackStore.getState().setTime(2.5);
    useProjectStore.getState().addAssetToTimeline(image('x'));

    // `x` se pose juste apres `b`, pas a la fin.
    expect(ordre()).toEqual(['a', 'b', 'x', 'c']);
  });

  it('ajoute a la fin quand la tete depasse le dernier plan', () => {
    const store = useProjectStore.getState();
    store.addAssetToTimeline(image('a'));
    store.addAssetToTimeline(image('b'));

    usePlaybackStore.getState().setTime(999);
    useProjectStore.getState().addAssetToTimeline(image('z'));

    expect(ordre()).toEqual(['a', 'b', 'z']);
  });

  it("conserve l'ordre d'un lot importe d'un coup", () => {
    const store = useProjectStore.getState();
    store.addAssetToTimeline(image('a'));
    store.addAssetToTimeline(image('b'));

    // Tete dans le premier plan, puis lot de trois sans la deplacer — c'est
    // exactement ce que fait la boucle d'import de `MediaSheet`.
    usePlaybackStore.getState().setTime(0.5);
    for (const id of ['1', '2', '3']) {
      useProjectStore.getState().addAssetToTimeline(image(id));
    }

    expect(ordre()).toEqual(['a', '1', '2', '3', 'b']);
  });

  it('respecte un rang impose explicitement', () => {
    const store = useProjectStore.getState();
    store.addAssetToTimeline(image('a'));
    store.addAssetToTimeline(image('b'));

    useProjectStore.getState().addAssetToTimeline(image('tete'), { index: 0 });
    expect(ordre()).toEqual(['tete', 'a', 'b']);
  });
});
