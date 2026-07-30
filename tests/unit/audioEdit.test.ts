/**
 * Edition audio non destructive.
 *
 * Le test central est celui de `scheduleSegments`: c'est la fonction PARTAGEE
 * par l'apercu et par le mixage d'export. Si elle se trompe, on entend un
 * montage different de celui qu'on exporte — un bug qui ne se decouvre qu'a la
 * fin, sur le fichier final.
 */

import { describe, expect, it } from 'vitest';

import {
  MIN_SEGMENT_DURATION,
  normalizeSegments,
  removeRange,
  removeSegment,
  scheduleSegments,
  segmentsDuration,
  setTrackRange,
  duplicateSegment,
  moveSegment,
  splitAt,
  trackSegments,
  updateSegment,
} from '@/domain/audioEdit';
import type { AudioTrack } from '@/domain/types';

const SOURCE_DURATION = 60;

function makeTrack(overrides: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id: 'atrack_1',
    kind: 'audio',
    assetId: 'asset_1',
    role: 'music',
    start: 0,
    source: { in: 0, out: SOURCE_DURATION },
    gain: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    ...overrides,
  };
}

describe('trackSegments', () => {
  it('deduit un segment unique de `source` quand le decoupage est absent', () => {
    const segments = trackSegments(makeTrack({ source: { in: 5, out: 25 } }));
    expect(segments).toHaveLength(1);
    expect(segments[0]!.in).toBe(5);
    expect(segments[0]!.out).toBe(25);
  });
});

describe('setTrackRange', () => {
  it('definit le debut et la fin, et revient a une piste continue', () => {
    const track = setTrackRange(makeTrack(), { in: 10, out: 30 }, SOURCE_DURATION);
    expect(track.source).toEqual({ in: 10, out: 30 });
    // Un seul extrait: `segments` est inutile et doit rester absent.
    expect(track.segments).toBeUndefined();
  });

  it('borne les valeurs a la duree de la source', () => {
    const track = setTrackRange(makeTrack(), { in: -5, out: 999 }, SOURCE_DURATION);
    expect(track.source.in).toBe(0);
    expect(track.source.out).toBe(SOURCE_DURATION);
  });

  it('refuse une plage trop courte plutot que de vider la piste', () => {
    const original = makeTrack();
    const track = setTrackRange(original, { in: 10, out: 10.001 }, SOURCE_DURATION);
    expect(track.source).toEqual(original.source);
  });
});

describe('removeRange', () => {
  it('scinde le segment traverse en deux', () => {
    const track = removeRange(makeTrack(), 20, 30, SOURCE_DURATION);
    const segments = trackSegments(track);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ in: 0, out: 20 });
    expect(segments[1]).toMatchObject({ in: 30, out: 60 });
    // Dix secondes retirees.
    expect(segmentsDuration(segments)).toBeCloseTo(50, 6);
  });

  it('raccourcit sans scinder quand la coupe touche un bord', () => {
    const track = removeRange(makeTrack(), 0, 10, SOURCE_DURATION);
    const segments = trackSegments(track);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ in: 10, out: 60 });
  });

  it('tolere des bornes inversees', () => {
    const forward = removeRange(makeTrack(), 20, 30, SOURCE_DURATION);
    const backward = removeRange(makeTrack(), 30, 20, SOURCE_DURATION);
    expect(segmentsDuration(trackSegments(backward))).toBeCloseTo(
      segmentsDuration(trackSegments(forward)),
      6,
    );
  });

  it('garde `source` englobant apres decoupage', () => {
    const track = removeRange(makeTrack(), 20, 30, SOURCE_DURATION);
    // `timelineGrid` lit encore `source`: il doit couvrir tous les segments,
    // sinon la grille des beats serait tronquee.
    expect(track.source.in).toBe(0);
    expect(track.source.out).toBe(60);
  });
});

describe('splitAt', () => {
  it('cree une frontiere sans rien retirer', () => {
    const track = splitAt(makeTrack(), 25, SOURCE_DURATION);
    const segments = trackSegments(track);

    expect(segments).toHaveLength(2);
    // La duree audible est inchangee: une coupe seule est inaudible.
    expect(segmentsDuration(segments)).toBeCloseTo(SOURCE_DURATION, 6);
  });

  it('ne coupe pas au ras d\'un bord', () => {
    const track = splitAt(makeTrack(), 0.001, SOURCE_DURATION);
    expect(trackSegments(track)).toHaveLength(1);
  });
});

describe('removeSegment', () => {
  it('supprime un passage', () => {
    const cut = splitAt(makeTrack(), 30, SOURCE_DURATION);
    const first = trackSegments(cut)[0]!;

    const track = removeSegment(cut, first.id, SOURCE_DURATION);
    const segments = trackSegments(track);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ in: 30, out: 60 });
  });

  it('refuse de supprimer le dernier passage', () => {
    const track = makeTrack();
    const only = trackSegments(track)[0]!;
    const result = removeSegment(track, only.id, SOURCE_DURATION);
    // Une piste sans audio n'a pas de sens: c'est une piste a supprimer.
    expect(trackSegments(result)).toHaveLength(1);
  });
});

describe('normalizeSegments', () => {
  it('fusionne les segments qui se chevauchent', () => {
    const merged = normalizeSegments(
      [
        { id: 'a', in: 0, out: 10 },
        { id: 'b', in: 8, out: 20 },
      ],
      { duration: SOURCE_DURATION },
    );
    expect(merged).toHaveLength(1);
    expect(merged![0]).toMatchObject({ in: 0, out: 20 });
  });

  it('conserve deux segments jointifs', () => {
    // Sans cela, une coupe posee par `splitAt` serait annulee aussitot: les deux
    // morceaux se touchent par construction.
    const merged = normalizeSegments(
      [
        { id: 'a', in: 0, out: 25 },
        { id: 'b', in: 25, out: 60 },
      ],
      { duration: SOURCE_DURATION },
    );
    expect(merged).toHaveLength(2);
  });

  it('remet les segments en ordre', () => {
    const sorted = normalizeSegments(
      [
        { id: 'b', in: 30, out: 40 },
        { id: 'a', in: 0, out: 10 },
      ],
      { duration: SOURCE_DURATION },
    );
    expect(sorted!.map((segment) => segment.in)).toEqual([0, 30]);
  });

  it('renvoie null quand rien ne subsiste', () => {
    const result = normalizeSegments(
      [{ id: 'a', in: 5, out: 5 + MIN_SEGMENT_DURATION / 2 }],
      { duration: SOURCE_DURATION },
    );
    // `null` = "operation impossible": l'appelant doit refuser, pas ecrire vide.
    expect(result).toBeNull();
  });
});

describe('updateSegment', () => {
  it('modifie une seule borne', () => {
    const cut = splitAt(makeTrack(), 30, SOURCE_DURATION);
    const second = trackSegments(cut)[1]!;

    const track = updateSegment(cut, second.id, { out: 45 }, SOURCE_DURATION);
    const segments = trackSegments(track);
    expect(segments[1]).toMatchObject({ in: 30, out: 45 });
  });
});

describe('scheduleSegments', () => {
  it('joue les passages bout a bout, sans trou', () => {
    // On retire [20, 30]: il reste [0,20] puis [30,60].
    const track = removeRange(makeTrack(), 20, 30, SOURCE_DURATION);

    const scheduled = scheduleSegments(track, {
      from: 0,
      until: 100,
      sourceDuration: SOURCE_DURATION,
    });

    expect(scheduled).toHaveLength(2);
    // Premier passage: a l'instant 0, depuis le debut de la source.
    expect(scheduled[0]).toMatchObject({ at: 0, offset: 0, duration: 20 });
    // Second passage: il ENCHAINE a 20 sur la timeline, mais lit la source a 30.
    // C'est tout l'interet du decoupage: le silence retire ne prend pas de place.
    expect(scheduled[1]).toMatchObject({ at: 20, offset: 30, duration: 30 });
  });

  it('tient compte du decalage de la piste', () => {
    const track = makeTrack({ start: 5, source: { in: 0, out: 10 } });
    const scheduled = scheduleSegments(track, {
      from: 0,
      until: 100,
      sourceDuration: SOURCE_DURATION,
    });
    expect(scheduled[0]).toMatchObject({ at: 5, offset: 0, duration: 10 });
  });

  it('entre au bon endroit de la source quand la lecture demarre au milieu', () => {
    const track = removeRange(makeTrack(), 20, 30, SOURCE_DURATION);

    // On demarre a 25 sur la TIMELINE, donc dans le second passage (qui commence
    // a 20 sur la timeline et lit la source a partir de 30).
    const scheduled = scheduleSegments(track, {
      from: 25,
      until: 100,
      sourceDuration: SOURCE_DURATION,
    });

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.at).toBe(25);
    // 5 s deja ecoulees dans ce passage: la source est lue a 30 + 5.
    expect(scheduled[0]!.offset).toBeCloseTo(35, 6);
    expect(scheduled[0]!.duration).toBeCloseTo(25, 6);
  });

  it('ignore les passages entierement joues', () => {
    // Segments [0,20] et [30,60], soit 50 s audibles: la piste occupe [0, 50] sur
    // la timeline. Demarrer a 45 tombe donc dans le second passage.
    const track = removeRange(makeTrack(), 20, 30, SOURCE_DURATION);
    const scheduled = scheduleSegments(track, {
      from: 45,
      until: 100,
      sourceDuration: SOURCE_DURATION,
    });

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.at).toBe(45);
    // 25 s deja ecoulees dans un passage qui lit la source depuis 30.
    expect(scheduled[0]!.offset).toBeCloseTo(55, 6);
  });

  it('ne planifie rien quand la lecture depasse la fin de la piste', () => {
    const track = removeRange(makeTrack(), 20, 30, SOURCE_DURATION);
    // La piste s'arrete a 50 sur la timeline: a 55 il n'y a plus rien.
    const scheduled = scheduleSegments(track, {
      from: 55,
      until: 100,
      sourceDuration: SOURCE_DURATION,
    });
    expect(scheduled).toHaveLength(0);
  });

  it('coupe net a la fin du reel', () => {
    const track = makeTrack();
    const scheduled = scheduleSegments(track, {
      from: 0,
      until: 8,
      sourceDuration: SOURCE_DURATION,
    });
    // La video s'arrete a 8 s: l'audio ne doit pas etre planifie au-dela.
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.duration).toBeCloseTo(8, 6);
  });

  it('ne planifie rien apres la fin du reel', () => {
    const track = makeTrack({ start: 20 });
    const scheduled = scheduleSegments(track, {
      from: 0,
      until: 10,
      sourceDuration: SOURCE_DURATION,
    });
    expect(scheduled).toHaveLength(0);
  });

  it('conserve la duree audible totale', () => {
    const track = removeRange(makeTrack(), 15, 25, SOURCE_DURATION);
    const scheduled = scheduleSegments(track, {
      from: 0,
      until: 1000,
      sourceDuration: SOURCE_DURATION,
    });

    const total = scheduled.reduce((sum, segment) => sum + segment.duration, 0);
    expect(total).toBeCloseTo(segmentsDuration(trackSegments(track)), 6);
  });
});

describe('removeSegment — aimant', () => {
  /** Piste a 10 s, trois passages de 2 s (source 0-6). */
  function threeSegments(magnet?: boolean): AudioTrack {
    return makeTrack({
      start: 10,
      magnet,
      segments: [
        { id: 'a', in: 0, out: 2 },
        { id: 'b', in: 2, out: 4 },
        { id: 'c', in: 4, out: 6 },
      ],
    });
  }

  /** Instants TIMELINE de chaque passage, via la voie de planification unique. */
  function positions(track: AudioTrack) {
    return scheduleSegments(track, {
      from: 0,
      until: Number.POSITIVE_INFINITY,
      sourceDuration: 6,
    }).map((s) => +s.at.toFixed(3));
  }

  it('recolle les passages suivants quand l aimant est actif', () => {
    // Comportement historique et defaut: la piste raccourcit.
    const after = removeSegment(threeSegments(true), 'b', 6);
    expect(positions(after)).toEqual([10, 12]);
  });

  it('recolle aussi quand `magnet` est absent', () => {
    // Absent vaut actif: les projets enregistres avant ce champ ne changent pas
    // de comportement.
    const after = removeSegment(threeSegments(undefined), 'b', 6);
    expect(positions(after)).toEqual([10, 12]);
  });

  it('laisse un silence et NE DECALE PAS la suite quand l aimant est inactif', () => {
    // Le point essentiel: `c` doit rester exactement ou il etait (14 s), et `a`
    // ne doit PAS bouger non plus.
    const before = positions(threeSegments(false));
    expect(before).toEqual([10, 12, 14]);

    const after = removeSegment(threeSegments(false), 'b', 6);
    expect(after.segments).toHaveLength(2);
    expect(positions(after)).toEqual([10, 14]);
  });

  it('laisse la suite en place en retirant le PREMIER passage', () => {
    // Cas particulier: aucun segment precedent ne peut porter le vide.
    const after = removeSegment(threeSegments(false), 'a', 6);
    // `b` et `c` restent a 12 et 14.
    expect(positions(after)).toEqual([12, 14]);
  });

  it('refuse de vider la piste', () => {
    const single = makeTrack({ magnet: false, segments: [{ id: 'only', in: 0, out: 3 }] });
    expect(removeSegment(single, 'only', 6)).toBe(single);
  });

  it('cumule deux suppressions sans decaler la suite', () => {
    // Deux retraits successifs ne doivent pas se marcher dessus.
    const step1 = removeSegment(threeSegments(false), 'b', 6);
    const step2 = removeSegment({ ...step1, magnet: false }, 'a', 6);
    // Seul `c` subsiste, toujours a 14 s.
    expect(positions(step2)).toEqual([14]);
  });
});

/**
 * Copier-coller et reordonnancement d'un passage.
 *
 * Piege central: `normalizeSegments` trie par borne d'entree et fusionne les
 * recouvrements. Deux copies d'un meme passage y seraient refondues en une, et
 * un deplacement serait annule par le tri. Ces deux operations contournent donc
 * la normalisation — ce que ces tests verrouillent.
 */
describe('duplicateSegment', () => {
  it('pose la copie juste apres l’original', () => {
    const track = makeTrack({
      segments: [
        { id: 'a', in: 0, out: 10 },
        { id: 'b', in: 10, out: 20 },
      ],
    });

    const result = duplicateSegment(track, 'a');
    const segments = trackSegments(result);

    expect(segments).toHaveLength(3);
    expect(segments.map((s) => `${s.in}-${s.out}`)).toEqual(['0-10', '0-10', '10-20']);
    // La copie porte un identifiant distinct: sans cela, toute action visant
    // « a » toucherait les deux.
    expect(segments[1]!.id).not.toBe('a');
  });

  it('laisse la piste intacte si le segment n’existe pas', () => {
    const track = makeTrack({ segments: [{ id: 'a', in: 0, out: 10 }] });
    expect(duplicateSegment(track, 'inconnu')).toBe(track);
  });
});

describe('moveSegment', () => {
  it('avance et recule un segment dans l’ordre de lecture', () => {
    const track = makeTrack({
      segments: [
        { id: 'a', in: 0, out: 10 },
        { id: 'b', in: 10, out: 20 },
        { id: 'c', in: 20, out: 30 },
      ],
    });

    const later = moveSegment(track, 'a', 1);
    expect(trackSegments(later).map((s) => s.id)).toEqual(['b', 'a', 'c']);

    const earlier = moveSegment(track, 'c', -1);
    expect(trackSegments(earlier).map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('ne fait rien aux extremites', () => {
    const track = makeTrack({
      segments: [
        { id: 'a', in: 0, out: 10 },
        { id: 'b', in: 10, out: 20 },
      ],
    });
    expect(moveSegment(track, 'a', -1)).toBe(track);
    expect(moveSegment(track, 'b', 1)).toBe(track);
  });
});
