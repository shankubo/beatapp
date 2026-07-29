import { describe, expect, it } from 'vitest';

import {
  MIN_AUTO_CUT,
  cutCount,
  cutIntoClips,
  cutRanges,
  frameForSource,
} from '@/domain/reelCut';
import { ripple } from '@/domain/timeline';
import { MIN_CLIP_DURATION, type Clip } from '@/domain/types';

const FPS = 30;

const TEMPLATE: Omit<Clip, 'id' | 'start' | 'duration' | 'source'> = {
  assetId: 'asset_reel',
  fit: 'cover',
  transform: { scale: 1, x: 0, y: 0, rotation: 0 },
  muted: false,
};

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `clip_${i}`);
}

describe('cutRanges', () => {
  it('couvre la source sans trou ni recouvrement', () => {
    /*
      L'invariant central: le montage decoupe doit durer aussi longtemps que la
      video d'origine. Un trou perdrait des images, un recouvrement en
      rejouerait.
    */
    const ranges = cutRanges({ duration: 10, cuts: [2, 5, 7] });
    expect(ranges).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 5 },
      { from: 5, to: 7 },
      { from: 7, to: 10 },
    ]);
  });

  it('rend un seul plan sans instant de coupe', () => {
    expect(cutRanges({ duration: 8, cuts: [] })).toEqual([{ from: 0, to: 8 }]);
  });

  it('trie et dedoublonne les instants recus', () => {
    // Une liste venue d'une detection n'est jamais propre par construction.
    const ranges = cutRanges({ duration: 10, cuts: [5, 2, 5, 2] });
    expect(ranges.map((r) => r.from)).toEqual([0, 2, 5]);
  });

  it('ecarte les instants hors de la source', () => {
    const ranges = cutRanges({ duration: 10, cuts: [-3, 0, 10, 42] });
    expect(ranges).toEqual([{ from: 0, to: 10 }]);
  });

  it('ignore une valeur non finie plutot que de la propager', () => {
    // Un NaN traverserait `ripple` et donnerait un plan de duree indefinie —
    // donc une image qui ne s'affiche jamais.
    const ranges = cutRanges({ duration: 10, cuts: [Number.NaN, 4, Infinity] });
    expect(ranges).toEqual([
      { from: 0, to: 4 },
      { from: 4, to: 10 },
    ]);
  });

  it('refuse de produire un plan plus court que le plancher perceptif', () => {
    /*
      0,25 s et non une frame: le plancher technique autoriserait un plan de
      33 ms, qui est un clignotement et non une image. Des coupes rapprochees
      sont donc fusionnees.
    */
    const ranges = cutRanges({ duration: 5, cuts: [1, 1.05, 1.1, 3] });
    for (const range of ranges) {
      expect(range.to - range.from).toBeGreaterThanOrEqual(MIN_AUTO_CUT);
    }
    expect(ranges.map((r) => r.from)).toEqual([0, 1, 3]);
  });

  it('ecarte une coupe trop proche de la fin', () => {
    // Sinon le dernier plan serait un clignotement.
    const ranges = cutRanges({ duration: 5, cuts: [4.9] });
    expect(ranges).toEqual([{ from: 0, to: 5 }]);
  });

  it('rend un plan unique pour une source plus courte que le plancher', () => {
    const ranges = cutRanges({ duration: 0.1, cuts: [0.05] });
    expect(ranges).toEqual([{ from: 0, to: 0.1 }]);
  });
});

describe('cutIntoClips', () => {
  it('produit des clips contigus une fois ripplés', () => {
    const clips = ripple(
      cutIntoClips(TEMPLATE, ids(4), { duration: 10, cuts: [2, 5, 7] }),
      FPS,
    );
    expect(clips.map((c) => c.start)).toEqual([0, 2, 5, 7]);
    expect(clips[3]!.start + clips[3]!.duration).toBeCloseTo(10, 6);
  });

  it('donne a chaque clip son extrait de source', () => {
    const clips = cutIntoClips(TEMPLATE, ids(3), { duration: 9, cuts: [3, 6] });
    expect(clips.map((c) => c.source)).toEqual([
      { in: 0, out: 3, speed: 1 },
      { in: 3, out: 6, speed: 1 },
      { in: 6, out: 9, speed: 1 },
    ]);
  });

  it('comprime la duree timeline a vitesse acceleree', () => {
    // Un extrait de 4 s joue a 2x n'occupe que 2 s de montage.
    const clips = cutIntoClips(TEMPLATE, ids(2), {
      duration: 8,
      cuts: [4],
      speed: 2,
    });
    expect(clips[0]!.duration).toBeCloseTo(2, 6);
    expect(clips[0]!.source).toEqual({ in: 0, out: 4, speed: 2 });
  });

  it('ignore une vitesse absurde plutot que de diviser par zero', () => {
    const clips = cutIntoClips(TEMPLATE, ids(1), { duration: 4, cuts: [], speed: 0 });
    expect(clips[0]!.duration).toBeCloseTo(4, 6);
  });

  it('ne rend jamais plus de clips que d identifiants fournis', () => {
    const clips = cutIntoClips(TEMPLATE, ids(2), { duration: 10, cuts: [2, 4, 6, 8] });
    expect(clips).toHaveLength(2);
  });

  it('respecte la duree minimale d un clip', () => {
    const clips = cutIntoClips(TEMPLATE, ids(3), { duration: 6, cuts: [2, 4] });
    for (const clip of clips) {
      expect(clip.duration).toBeGreaterThanOrEqual(MIN_CLIP_DURATION);
    }
  });

  it('conserve les reglages du gabarit', () => {
    const clips = cutIntoClips(TEMPLATE, ids(2), { duration: 6, cuts: [3] });
    for (const clip of clips) {
      expect(clip.assetId).toBe('asset_reel');
      expect(clip.fit).toBe('cover');
      expect(clip.muted).toBe(false);
    }
  });
});

describe('frameForSource', () => {
  const REEL = { width: 1080, height: 1920, fps: 30 };
  const LANDSCAPE = { width: 1920, height: 1080, fps: 30 };

  it('adopte le format du reel importe', () => {
    // Sans cela, un reel 9:16 dans un projet 16:9 serait recadre par le `cover`
    // par defaut: l'utilisateur verrait son reel amoindri sans comprendre.
    const frame = frameForSource(LANDSCAPE, { width: 1080, height: 1920 });
    expect(frame.width).toBe(1080);
    expect(frame.height).toBe(1920);
  });

  it('conserve le fps du projet', () => {
    // Il gouverne la quantification de toute la timeline: le changer decalerait
    // les durees deja posees.
    const frame = frameForSource({ ...LANDSCAPE, fps: 24 }, { width: 1080, height: 1920 });
    expect(frame.fps).toBe(24);
  });

  it('force des cotes pairs', () => {
    // H.264 en 4:2:0 echoue a l'execution sur un cote impair, apres plusieurs
    // secondes d'encodage.
    const frame = frameForSource(REEL, { width: 1081, height: 1921 });
    expect(frame.width % 2).toBe(0);
    expect(frame.height % 2).toBe(0);
  });

  it('renvoie le cadre d origine quand rien ne change', () => {
    // Meme reference: cela evite une entree d'historique sans effet visible.
    expect(frameForSource(REEL, { width: 1080, height: 1920 })).toBe(REEL);
  });

  it('ignore des dimensions absentes ou absurdes', () => {
    for (const source of [
      {},
      { width: 0, height: 100 },
      { width: 100, height: -5 },
      { width: Number.NaN, height: 100 },
    ]) {
      expect(frameForSource(REEL, source)).toBe(REEL);
    }
  });
});

describe('cutCount', () => {
  it('annonce exactement le nombre d identifiants a fournir', () => {
    // L'appelant genere les ids AVANT d'appeler `cutIntoClips`, le domaine n'en
    // fabriquant pas: un compte faux laisserait des plans sans identifiant.
    for (const cuts of [[], [5], [2, 4, 6], [1, 1.05, 3]]) {
      const options = { duration: 10, cuts };
      expect(cutCount(options)).toBe(cutRanges(options).length);
    }
  });
});
