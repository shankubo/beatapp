/**
 * Retrait de TOUS les effets d'un clip, contre le vrai store.
 *
 * Le panneau n'est pas testable directement — le projet evite toute bibliotheque
 * de rendu de composants — mais le geste qu'il declenche l'est: un seul
 * `updateClip` portant les trois champs a effacer. On verifie ici ce qui compte
 * vraiment, et que le composant ne peut pas garantir seul: que l'effacement est
 * complet, qu'il ne touche pas au cadrage, et qu'un unique « annuler » le defait.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { useProjectStore } from '@/store/useProjectStore';
import { filterForPreset } from '@/domain/project';
import type { Clip, MediaAsset } from '@/domain/types';

function imageAsset(id: string): MediaAsset {
  return {
    id,
    kind: 'image',
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    bytes: 100_000,
    storage: { backend: 'idb', key: `${id}.bin` },
    width: 1080,
    height: 1920,
    createdAt: Date.now(),
  };
}

/** Reproduit le patch pose par `clearEffects` du panneau Effets. */
const CLEAR_PATCH: Partial<Clip> = {
  transitionIn: undefined,
  filter: undefined,
  kenBurns: undefined,
};

/** Deux plans, tous deux charges d'effets. */
function projectWithEffects(): void {
  const asset = imageAsset('asset_fx');
  const store = useProjectStore.getState();
  const project = store.project;

  const clips: Clip[] = ['clip_a', 'clip_b'].map((id, index) => ({
    id,
    assetId: asset.id,
    start: index * 2,
    duration: 2,
    // Cadrage volontairement NON par defaut: on verifie qu'il survit.
    fit: 'contain',
    transform: { scale: 1.4, x: 0.1, y: -0.2, rotation: 0.3 },
    muted: false,
    filter: filterForPreset('vivid'),
    kenBurns: { toScale: 1.12, toX: 0, toY: 0 },
    ...(index > 0
      ? { transitionIn: { type: 'paperSlideLeft' as const, duration: 0.3, accent: 'shake' as const } }
      : {}),
  }));

  store.replaceProject({
    ...project,
    assets: { ...project.assets, [asset.id]: asset },
    videoTrack: { ...project.videoTrack, clips },
  });
}

const clipsOf = () => useProjectStore.getState().project.videoTrack.clips;

describe('retrait de tous les effets', () => {
  beforeEach(() => {
    useProjectStore.getState().newProject('Effets');
    projectWithEffects();
  });

  it('efface transition, accent, filtre et zoom lent d un clip', () => {
    useProjectStore.getState().updateClip('clip_b', CLEAR_PATCH);

    const clip = clipsOf().find((c) => c.id === 'clip_b')!;
    expect(clip.transitionIn).toBeUndefined();
    expect(clip.filter).toBeUndefined();
    expect(clip.kenBurns).toBeUndefined();
  });

  it('laisse le cadrage et le recadrage intacts', () => {
    /*
      La limite volontaire du bouton: `fit` et `transform` decrivent comment
      l'image entre dans le format, pas un effet ajoute. Les effacer deferait un
      travail de cadrage que personne ne pense confier a « retirer les effets ».
    */
    useProjectStore.getState().updateClip('clip_b', CLEAR_PATCH);

    const clip = clipsOf().find((c) => c.id === 'clip_b')!;
    expect(clip.fit).toBe('contain');
    expect(clip.transform.scale).toBeCloseTo(1.4, 6);
    expect(clip.transform.x).toBeCloseTo(0.1, 6);
    expect(clip.transform.rotation).toBeCloseTo(0.3, 6);
    // La duree et la place sur la timeline ne bougent pas non plus.
    expect(clip.duration).toBeCloseTo(2, 6);
  });

  it('n affecte que le clip vise en portee « ce clip »', () => {
    useProjectStore.getState().updateClip('clip_b', CLEAR_PATCH);

    const other = clipsOf().find((c) => c.id === 'clip_a')!;
    expect(other.filter).toBeDefined();
    expect(other.kenBurns).toBeDefined();
  });

  it('vide tout le montage en portee globale', () => {
    for (const clip of clipsOf()) {
      useProjectStore.getState().updateClip(clip.id, CLEAR_PATCH);
    }

    for (const clip of clipsOf()) {
      expect(clip.transitionIn, clip.id).toBeUndefined();
      expect(clip.filter, clip.id).toBeUndefined();
      expect(clip.kenBurns, clip.id).toBeUndefined();
    }
  });

  it('se defait d un seul annuler pour un clip', () => {
    /*
      Les trois champs partent dans UN patch, donc une seule entree
      d'historique. Trois appels separes obligeraient a annuler trois fois pour
      recuperer un etat que l'utilisateur a perdu d'un seul geste.
    */
    useProjectStore.getState().updateClip('clip_b', CLEAR_PATCH);
    expect(clipsOf().find((c) => c.id === 'clip_b')!.filter).toBeUndefined();

    useProjectStore.temporal.getState().undo();

    const restored = clipsOf().find((c) => c.id === 'clip_b')!;
    expect(restored.filter).toBeDefined();
    expect(restored.kenBurns).toBeDefined();
    expect(restored.transitionIn?.type).toBe('paperSlideLeft');
    // L'accent revient avec sa transition: il y est range, pas a cote.
    expect(restored.transitionIn?.accent).toBe('shake');
  });
});
