import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  appendClip,
  assertTrackInvariants,
  clipAt,
  clipIndexAt,
  duplicateClip,
  effectiveTransition,
  maxTransitionDuration,
  uniformTransitionLimit,
  moveClip,
  removeClip,
  ripple,
  setClipDuration,
  setUniformDuration,
  sourceTimeAt,
  trimClipEnd,
  trimClipStart,
  videoDuration,
  splitClipAt,
} from '@/domain/timeline';
import { MIN_CLIP_DURATION, type Clip, type VideoTrack } from '@/domain/types';

const FPS = 30;

function clip(id: string, duration: number, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    assetId: `asset_${id}`,
    start: 0,
    duration,
    fit: 'cover',
    transform: { scale: 1, x: 0, y: 0, rotation: 0 },
    muted: false,
    ...extra,
  };
}

function track(...clips: Clip[]): VideoTrack {
  return { id: 'vtrack', kind: 'video', clips: ripple(clips, FPS) };
}

describe('ripple', () => {
  it('rend la piste contigue et sans trou', () => {
    const clips = ripple([clip('a', 1), clip('b', 2), clip('c', 0.5)], FPS);
    expect(clips.map((c) => c.start)).toEqual([0, 1, 3]);
  });

  it('force la duree minimale d une frame', () => {
    const clips = ripple([clip('a', 0), clip('b', -5)], FPS);
    expect(clips[0]!.duration).toBeCloseTo(MIN_CLIP_DURATION, 10);
    expect(clips[1]!.duration).toBeCloseTo(MIN_CLIP_DURATION, 10);
  });

  it('aligne les durees sur la grille de frames', () => {
    // 1.006s n'est pas un multiple de 1/30: doit etre arrondi a 30 frames.
    const clips = ripple([clip('a', 1.006)], FPS);
    expect(clips[0]!.duration * FPS).toBeCloseTo(Math.round(1.006 * FPS), 10);
  });

  it('preserve la contiguite pour des durees arbitraires (property test)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.05, max: 10, noNaN: true }), {
          minLength: 1,
          maxLength: 60,
        }),
        (durations) => {
          const clips = ripple(
            durations.map((d, i) => clip(`c${i}`, d)),
            FPS,
          );
          for (let i = 1; i < clips.length; i += 1) {
            const previous = clips[i - 1]!;
            const expected = previous.start + previous.duration;
            // Tolerance largement sous une frame.
            expect(Math.abs(clips[i]!.start - expected)).toBeLessThan(1e-9);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("n'accumule pas d'erreur flottante sur 100 clips", () => {
    // 0.1 n'est pas representable exactement en binaire: une somme naive
    // deriverait. On verifie que le cumul reste exact a la microseconde.
    const clips = ripple(
      Array.from({ length: 100 }, (_, i) => clip(`c${i}`, 0.1)),
      FPS,
    );
    expect(videoDuration({ id: 't', kind: 'video', clips })).toBeCloseTo(10, 6);
  });
});

describe('videoDuration', () => {
  it('vaut zero pour une piste vide', () => {
    expect(videoDuration(track())).toBe(0);
  });

  it('vaut la somme des durees', () => {
    expect(videoDuration(track(clip('a', 1.5), clip('b', 2.5)))).toBeCloseTo(4, 10);
  });
});

describe('clipIndexAt', () => {
  const t = track(clip('a', 1), clip('b', 2), clip('c', 1));

  it('trouve le clip courant', () => {
    expect(clipIndexAt(t, 0)).toBe(0);
    expect(clipIndexAt(t, 0.99)).toBe(0);
    expect(clipIndexAt(t, 1)).toBe(1);
    expect(clipIndexAt(t, 2.99)).toBe(1);
    expect(clipIndexAt(t, 3)).toBe(2);
  });

  it('renvoie le dernier clip a la duree totale exacte', () => {
    // La derniere frame doit exister: sinon l'export perd une frame.
    expect(clipIndexAt(t, 4)).toBe(2);
  });

  it('renvoie -1 avant le debut et pour une piste vide', () => {
    expect(clipIndexAt(t, -0.5)).toBe(-1);
    expect(clipIndexAt(track(), 0)).toBe(-1);
  });

  it('est coherent avec clipAt', () => {
    expect(clipAt(t, 1.5)?.id).toBe('b');
  });
});

describe('sourceTimeAt', () => {
  it('renvoie 0 pour une image (pas de source)', () => {
    expect(sourceTimeAt(clip('a', 2), 1)).toBe(0);
  });

  it('avance dans la source a vitesse 1', () => {
    const c = ripple([clip('v', 4, { source: { in: 10, out: 20, speed: 1 } })], FPS)[0]!;
    expect(sourceTimeAt(c, 0)).toBeCloseTo(10, 10);
    expect(sourceTimeAt(c, 2)).toBeCloseTo(12, 10);
  });

  it('applique la vitesse', () => {
    const c = ripple([clip('v', 4, { source: { in: 0, out: 20, speed: 2 } })], FPS)[0]!;
    expect(sourceTimeAt(c, 2)).toBeCloseTo(4, 10);
  });

  it('ne depasse jamais le point de sortie', () => {
    const c = ripple([clip('v', 10, { source: { in: 0, out: 3, speed: 1 } })], FPS)[0]!;
    expect(sourceTimeAt(c, 9)).toBeCloseTo(3, 10);
  });
});

describe('transitions', () => {
  it('borne la duree a la moitie du plus court voisin', () => {
    const t = track(clip('a', 4), clip('b', 1));
    expect(maxTransitionDuration(t.clips, 1)).toBeCloseTo(0.5, 10);
  });

  it('ne renvoie aucune transition sur le premier clip', () => {
    const t = track(clip('a', 2, { transitionIn: { type: 'fade', duration: 0.5 } }));
    expect(effectiveTransition(t.clips, 0)).toBeNull();
  });

  it('ecrete une transition trop longue', () => {
    const t = track(clip('a', 1), clip('b', 1, { transitionIn: { type: 'fade', duration: 5 } }));
    expect(effectiveTransition(t.clips, 1)?.duration).toBeCloseTo(0.5, 10);
  });

  it("traite 'none' comme absence de transition", () => {
    const t = track(clip('a', 2), clip('b', 2, { transitionIn: { type: 'none', duration: 1 } }));
    expect(effectiveTransition(t.clips, 1)).toBeNull();
  });

  it("conserve l'accent en ecretant la duree", () => {
    /*
      Regression: la fonction reconstruisait `{ type, duration }` champ par
      champ et laissait tomber `accent`. L'effet cumule etait donc
      silencieusement ignore a l'apercu ET a l'export, alors que le projet
      l'avait bien enregistre — un defaut invisible cote modele, attrape par une
      sonde de rendu.

      Le test ecrete volontairement la duree, pour couvrir le chemin qui
      reconstruit l'objet plutot que celui qui le renvoie tel quel.
    */
    const t = track(
      clip('a', 1),
      clip('b', 1, { transitionIn: { type: 'paperSlideLeft', duration: 5, accent: 'shake' } }),
    );
    const effective = effectiveTransition(t.clips, 1);
    expect(effective?.duration).toBeCloseTo(0.5, 10);
    expect(effective?.accent).toBe('shake');
    expect(effective?.type).toBe('paperSlideLeft');
  });

  it('retient le plan le plus court pour une duree uniforme', () => {
    /*
      Le MINIMUM et non le maximum: appliquee a tout le montage, une transition
      plus longue que le plan le plus court serait ecretee a l'affichage, et le
      curseur annoncerait une valeur que le montage ne respecte pas.
    */
    const t = track(clip('a', 4), clip('b', 4), clip('c', 1));
    expect(uniformTransitionLimit(t.clips)).toBeCloseTo(0.5, 10);
  });

  it('ignore le premier clip dans la duree uniforme', () => {
    // Il n'a rien avant lui, donc sa borne vaut zero: la compter ramenerait le
    // minimum a zero sur TOUT montage, et le curseur disparaitrait.
    const t = track(clip('a', 4), clip('b', 4));
    expect(uniformTransitionLimit(t.clips)).toBeCloseTo(2, 10);
  });

  it('renvoie zero quand il n y a pas de coupe', () => {
    expect(uniformTransitionLimit(track(clip('a', 4)).clips)).toBe(0);
    expect(uniformTransitionLimit([])).toBe(0);
  });

  it('est toujours tenable par chaque coupe du montage', () => {
    // La borne uniforme ne doit jamais depasser la borne locale d'une coupe,
    // sinon appliquer a tous produirait une transition ecretee quelque part.
    const t = track(clip('a', 3), clip('b', 1.5), clip('c', 6), clip('d', 2));
    const uniform = uniformTransitionLimit(t.clips);
    for (let i = 1; i < t.clips.length; i++) {
      expect(uniform, `coupe ${i}`).toBeLessThanOrEqual(maxTransitionDuration(t.clips, i));
    }
  });
});

describe('operations d edition', () => {
  it('ajoute, retire et conserve l invariant', () => {
    let t = track(clip('a', 1));
    t = appendClip(t, clip('b', 2), FPS);
    expect(t.clips.map((c) => c.id)).toEqual(['a', 'b']);
    assertTrackInvariants(t, FPS);

    t = removeClip(t, 'a', FPS);
    expect(t.clips[0]!.start).toBe(0);
    assertTrackInvariants(t, FPS);
  });

  it('supprime en laissant un vide: rien ne se decale', () => {
    // C'est la raison d'etre du vide: retirer un plan sans deplacer la suite,
    // pour que le son et le texte deja cales restent en face de leur image.
    const t = removeClip(track(clip('a', 1), clip('b', 2), clip('c', 3)), 'b', FPS, {
      leaveGap: true,
    });
    expect(t.clips.map((c) => c.id)).toEqual(['a', 'c']);
    // `c` commencait a 3 s; il doit y rester malgre la disparition de `b`.
    expect(t.clips[1]!.start).toBeCloseTo(3, 6);
    expect(t.clips[0]!.gap).toBeCloseTo(2, 6);
    assertTrackInvariants(t, FPS);
  });

  it('supprime sans vide: la suite remonte', () => {
    const t = removeClip(track(clip('a', 1), clip('b', 2), clip('c', 3)), 'b', FPS);
    expect(t.clips[1]!.start).toBeCloseTo(1, 6);
    expect(t.clips[0]!.gap).toBeUndefined();
    assertTrackInvariants(t, FPS);
  });

  it('retirer le PREMIER clip recolle, faute de porteur pour le vide', () => {
    // Un vide en tete ferait commencer le montage par du noir: on recolle.
    const t = removeClip(track(clip('a', 1), clip('b', 2)), 'a', FPS, { leaveGap: true });
    expect(t.clips[0]!.start).toBe(0);
    assertTrackInvariants(t, FPS);
  });

  it('cumule les vides de deux suppressions successives', () => {
    // Sans cumul, le vide deja pose serait perdu et la suite remonterait.
    let t = track(clip('a', 1), clip('b', 2), clip('c', 3), clip('d', 1));
    t = removeClip(t, 'b', FPS, { leaveGap: true });
    t = removeClip(t, 'c', FPS, { leaveGap: true });
    expect(t.clips.map((c) => c.id)).toEqual(['a', 'd']);
    // `d` commencait a 6 s (1 + 2 + 3): il doit y rester.
    expect(t.clips[1]!.start).toBeCloseTo(6, 6);
    assertTrackInvariants(t, FPS);
  });

  it('un vide ne fait pas afficher le dernier plan', () => {
    // `clipIndexAt` renvoyait le dernier clip des que le temps le depassait:
    // un vide final aurait fige la derniere image au lieu du fond.
    const t = removeClip(track(clip('a', 1), clip('b', 2), clip('c', 3)), 'b', FPS, {
      leaveGap: true,
    });
    // 2 s tombe en plein dans le vide laisse par `b` (de 1 s a 3 s).
    expect(clipIndexAt(t, 2)).toBe(-1);
  });

  it('deplace un clip et recalcule les positions', () => {
    const t = moveClip(track(clip('a', 1), clip('b', 2), clip('c', 3)), 2, 0, FPS);
    expect(t.clips.map((c) => c.id)).toEqual(['c', 'a', 'b']);
    expect(t.clips.map((c) => c.start)).toEqual([0, 3, 4]);
  });

  it('duplique un clip juste apres l original', () => {
    const t = duplicateClip(track(clip('a', 1), clip('b', 1)), 'a', 'a2', FPS);
    expect(t.clips.map((c) => c.id)).toEqual(['a', 'a2', 'b']);
  });

  it('borne la duree d un clip video a l extrait source disponible', () => {
    const t = track(clip('v', 2, { source: { in: 0, out: 3, speed: 1 } }));
    const stretched = setClipDuration(t, 'v', 99, FPS);
    // 3 secondes de source a vitesse 1 => 3 secondes maximum.
    expect(stretched.clips[0]!.duration).toBeCloseTo(3, 10);
  });

  it('un trim manuel libere le verrou de beat', () => {
    const t = track(clip('a', 2, { beatLocked: true }));
    expect(setClipDuration(t, 'a', 1, FPS).clips[0]!.beatLocked).toBe(false);
  });

  it('trimClipStart deplace le point d entree et raccourcit la duree', () => {
    const t = track(clip('v', 4, { source: { in: 2, out: 10, speed: 1 } }));
    const trimmed = trimClipStart(t, 'v', 1, FPS);
    expect(trimmed.clips[0]!.source!.in).toBeCloseTo(3, 10);
    expect(trimmed.clips[0]!.duration).toBeCloseTo(3, 10);
  });

  it('trimClipEnd allonge dans la limite de la source', () => {
    const t = track(clip('v', 2, { source: { in: 0, out: 5, speed: 1 } }));
    expect(trimClipEnd(t, 'v', 1, FPS).clips[0]!.duration).toBeCloseTo(3, 10);
    expect(trimClipEnd(t, 'v', 99, FPS).clips[0]!.duration).toBeCloseTo(5, 10);
  });

  it('applique une duree uniforme', () => {
    const t = setUniformDuration(track(clip('a', 1), clip('b', 5)), 2, FPS);
    expect(t.clips.map((c) => c.duration)).toEqual([2, 2]);
    expect(t.clips.map((c) => c.start)).toEqual([0, 2]);
  });
});

describe('assertTrackInvariants', () => {
  it('detecte une piste non contigue', () => {
    const broken: VideoTrack = {
      id: 't',
      kind: 'video',
      clips: [clip('a', 1), { ...clip('b', 1), start: 5 }],
    };
    expect(() => assertTrackInvariants(broken, FPS)).toThrow(/non contigue/);
  });

  it('accepte toute piste issue de ripple (property test)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.05, max: 5, noNaN: true }), { minLength: 1, maxLength: 40 }),
        (durations) => {
          const t = track(...durations.map((d, i) => clip(`c${i}`, d)));
          expect(() => assertTrackInvariants(t, FPS)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('splitClipAt', () => {
  it('coupe en deux morceaux contigus qui couvrent la duree d origine', () => {
    const original = track(clip('a', 4));
    const split = splitClipAt(original, 1.5, 'new', FPS);

    expect(split.clips).toHaveLength(2);
    expect(split.clips[0]!.duration + split.clips[1]!.duration).toBeCloseTo(4, 6);
    // Contigus: le second commence ou le premier finit.
    expect(split.clips[1]!.start).toBeCloseTo(
      split.clips[0]!.start + split.clips[0]!.duration,
      6,
    );
  });

  it('ne change pas la duree totale du montage', () => {
    // Le point le plus important: couper ne doit RIEN decaler en aval. La
    // tolerance vaut une frame, `ripple` quantifiant chaque duree sur la grille
    // (voir le test de propriete plus bas).
    const original = track(clip('a', 2), clip('b', 3), clip('c', 1));
    const before = videoDuration(original);
    const split = splitClipAt(original, 3, 'new', FPS);
    expect(Math.abs(videoDuration(split) - before)).toBeLessThanOrEqual(1 / FPS + 1e-9);
  });

  it('coupe le clip situe SOUS l instant demande', () => {
    const original = track(clip('a', 2), clip('b', 3));
    // 3 s tombe dans le second clip (2 -> 5).
    const split = splitClipAt(original, 3, 'new', FPS);
    expect(split.clips.map((c) => c.id)).toEqual(['a', 'b', 'new']);
  });

  it('avance le point d entree de la source sur le second morceau', () => {
    // Sans cela, la coupe rejouerait le debut de l'extrait au lieu de continuer.
    const original = track(
      clip('a', 4, { source: { in: 10, out: 20, speed: 1 } }),
    );
    const split = splitClipAt(original, 1.5, 'new', FPS);
    expect(split.clips[0]!.source!.in).toBe(10);
    expect(split.clips[1]!.source!.in).toBeCloseTo(11.5, 6);
  });

  it('tient compte de la vitesse dans l avance de la source', () => {
    // A vitesse 2, une seconde de timeline consomme deux secondes de source.
    const original = track(
      clip('a', 4, { source: { in: 0, out: 20, speed: 2 } }),
    );
    const split = splitClipAt(original, 1.5, 'new', FPS);
    expect(split.clips[1]!.source!.in).toBeCloseTo(3, 6);
  });

  it('laisse une image sans source', () => {
    const original = track(clip('a', 4));
    const split = splitClipAt(original, 2, 'new', FPS);
    expect(split.clips[0]!.source).toBeUndefined();
    expect(split.clips[1]!.source).toBeUndefined();
  });

  it('refuse de produire un fragment trop court', () => {
    const original = track(clip('a', 4));
    // Trop pres du debut, puis trop pres de la fin: aucune coupe.
    expect(splitClipAt(original, MIN_CLIP_DURATION / 2, 'new', FPS).clips).toHaveLength(1);
    expect(splitClipAt(original, 4 - MIN_CLIP_DURATION / 2, 'new', FPS).clips).toHaveLength(1);
  });

  it('ne fait rien hors du montage', () => {
    const original = track(clip('a', 2));
    expect(splitClipAt(original, 99, 'new', FPS).clips).toHaveLength(1);
    expect(splitClipAt(original, -1, 'new', FPS).clips).toHaveLength(1);
  });

  it('efface `beatLocked` sur les deux morceaux', () => {
    // Leurs durees ne sont plus celles posees par l'aimantation: garder le
    // liseré chartreuse serait mensonger.
    const original = track(clip('a', 4, { beatLocked: true }));
    const split = splitClipAt(original, 2, 'new', FPS);
    expect(split.clips[0]!.beatLocked).toBe(false);
    expect(split.clips[1]!.beatLocked).toBe(false);
  });

  it('retire la transition d entree du second morceau', () => {
    // Heriter du fondu de l'original le rejouerait au milieu du plan.
    const original = track(
      clip('a', 4, { transitionIn: { type: 'fade', duration: 0.3 } }),
    );
    const split = splitClipAt(original, 2, 'new', FPS);
    expect(split.clips[0]!.transitionIn).toEqual({ type: 'fade', duration: 0.3 });
    expect(split.clips[1]!.transitionIn).toBeUndefined();
  });

  it('conserve le cadrage et les filtres sur les deux morceaux', () => {
    const original = track(
      clip('a', 4, { fit: 'contain', transform: { scale: 1.4, x: 0.1, y: 0, rotation: 0 } }),
    );
    const split = splitClipAt(original, 2, 'new', FPS);
    for (const piece of split.clips) {
      expect(piece.fit).toBe('contain');
      expect(piece.transform.scale).toBe(1.4);
    }
  });

  it('garde la piste valide quel que soit le point de coupe', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.05, max: 5.95, noNaN: true }), (at) => {
        const original = track(clip('a', 2), clip('b', 4));
        const split = splitClipAt(original, at, 'new', FPS);
        assertTrackInvariants(split, FPS);

        /**
         * La duree totale est preservee A UNE FRAME PRES, pas a l'exact.
         *
         * `ripple` quantifie chaque duree sur la grille de frames — invariant du
         * projet, sans lequel une coupe tomberait au milieu d'une frame et
         * l'export deriverait par rapport a l'apercu. Deux morceaux peuvent donc
         * arrondir chacun vers le haut. Mesure: +0,0333 s, soit exactement une
         * frame a 30 i/s.
         */
        const drift = Math.abs(videoDuration(split) - videoDuration(original));
        expect(drift).toBeLessThanOrEqual(1 / FPS + 1e-9);
      }),
    );
  });
});
