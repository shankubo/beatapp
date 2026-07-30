/**
 * Edition non destructive de l'audio. Module PUR.
 *
 * Une piste est decrite par une liste de segments joues bout a bout. Retirer un
 * passage revient donc a couper un segment en deux et a jeter le morceau du
 * milieu: la source n'est jamais modifiee, et l'operation est annulable.
 *
 * Invariants, retablis par `normalizeSegments` apres chaque operation:
 * - les segments sont dans l'ordre, disjoints, et verifient `in < out`;
 * - il en reste toujours au moins un (une piste sans audio n'a pas de sens:
 *   c'est une piste qu'il faut supprimer).
 */

import { newId } from '../lib/id';
import type { AudioSegment, AudioTrack, Id, Seconds } from './types';

/** Duree minimale d'un segment. En dessous, ce n'est plus audible. */
export const MIN_SEGMENT_DURATION: Seconds = 0.05;

/** Les segments d'une piste, `source` faisant foi si le decoupage est absent. */
export function trackSegments(track: AudioTrack): AudioSegment[] {
  if (track.segments && track.segments.length > 0) return track.segments;
  return [{ id: `${track.id}_seg0`, in: track.source.in, out: track.source.out }];
}

/** Duree totale audible: la somme des segments, et non `out - in`. */
export function segmentsDuration(segments: readonly AudioSegment[]): Seconds {
  return segments.reduce((total, segment) => total + Math.max(0, segment.out - segment.in), 0);
}

export function trackDuration(track: AudioTrack): Seconds {
  return segmentsDuration(trackSegments(track));
}

/** Un segment a jouer, deja place sur la timeline. */
export interface ScheduledSegment {
  /** Instant TIMELINE ou demarrer. */
  at: Seconds;
  /** Decalage dans la SOURCE. */
  offset: Seconds;
  duration: Seconds;
}

/**
 * Convertit les segments d'une piste en evenements de lecture.
 *
 * C'est la fonction PARTAGEE par l'apercu temps reel et le mixage d'export:
 * elle seule sait ou tombe chaque morceau. Les faire divergerait ferait entendre
 * un montage different de celui qu'on exporte — exactement le genre de bug qui
 * ne se voit qu'a la fin.
 *
 * @param from Position de lecture TIMELINE. Un segment deja passe est ignore, et
 *   celui qui contient `from` demarre au bon endroit de la source.
 * @param until Fin du reel: rien n'est planifie au-dela.
 */
export function scheduleSegments(
  track: AudioTrack,
  options: { from: Seconds; until: Seconds; sourceDuration: Seconds },
): ScheduledSegment[] {
  const { from, until, sourceDuration } = options;
  const result: ScheduledSegment[] = [];

  // Position sur la timeline du debut du segment courant.
  let cursor = track.start;

  for (const segment of trackSegments(track)) {
    const offset = Math.min(segment.in, sourceDuration);
    const available = Math.min(segment.out, sourceDuration) - offset;
    if (available <= 0) continue;

    const segmentStart = cursor;
    const segmentEnd = cursor + available;
    // Le silence eventuel s'ajoute APRES le segment: le curseur avance donc de
    // la duree audible PLUS le vide, ce qui laisse la suite exactement en place.
    cursor = segmentEnd + Math.max(0, segment.gap ?? 0);

    if (segmentEnd <= from) continue; // deja passe
    if (segmentStart >= until) break; // au-dela de la fin du reel

    // Si la lecture commence au milieu de ce segment, on entre dans la source
    // d'autant.
    const skipped = Math.max(0, from - segmentStart);
    const at = Math.max(segmentStart, from);
    const duration = Math.min(available - skipped, until - at);
    if (duration <= 0) continue;

    result.push({ at, offset: offset + skipped, duration });
  }

  return result;
}

/**
 * Remet une liste de segments en ordre, fusionne ceux qui se chevauchent et
 * ecarte ceux qui sont trop courts.
 *
 * Renvoie `null` si plus rien ne subsiste: l'appelant doit alors refuser
 * l'operation plutot que d'ecrire une piste vide.
 */
export function normalizeSegments(
  segments: readonly AudioSegment[],
  bounds: { duration: Seconds },
): AudioSegment[] | null {
  const clamped = segments
    .map((segment) => ({
      ...segment,
      in: Math.max(0, Math.min(segment.in, bounds.duration)),
      out: Math.max(0, Math.min(segment.out, bounds.duration)),
    }))
    .filter((segment) => segment.out - segment.in >= MIN_SEGMENT_DURATION)
    .sort((a, b) => a.in - b.in);

  if (clamped.length === 0) return null;

  const merged: AudioSegment[] = [];
  for (const segment of clamped) {
    const previous = merged[merged.length - 1];
    /**
     * On fusionne les segments qui se CHEVAUCHENT, pas ceux qui se touchent.
     *
     * La distinction est essentielle: `splitAt` produit deux segments adjacents
     * (`[0,25]` et `[25,60]`), et les fusionner annulerait la coupe — une coupe
     * ne survivrait jamais a la normalisation. Deux segments jointifs restent
     * donc distincts; a la lecture ils s'enchainent sans silence, ce qui est
     * exactement le resultat attendu.
     */
    if (previous && segment.in < previous.out) {
      previous.out = Math.max(previous.out, segment.out);
    } else {
      merged.push({ ...segment });
    }
  }

  return merged;
}

/**
 * Definit le debut et la fin de la portion utilisee.
 *
 * C'est l'operation la plus courante: garder le refrain d'un morceau. Elle
 * remplace tout decoupage existant, ce qui est le comportement attendu quand on
 * redefinit les bornes globales.
 */
export function setTrackRange(
  track: AudioTrack,
  range: { in: Seconds; out: Seconds },
  sourceDuration: Seconds,
): AudioTrack {
  const normalized = normalizeSegments(
    [{ id: newId('seg'), in: range.in, out: range.out }],
    { duration: sourceDuration },
  );
  if (!normalized) return track;

  const first = normalized[0]!;
  return {
    ...track,
    source: { in: first.in, out: first.out },
    // Un seul segment: on revient a la representation continue, plus simple.
    segments: undefined,
  };
}

/**
 * Retire l'intervalle `[from, to]` de la piste.
 *
 * Un segment traverse par l'intervalle est scinde en deux. C'est ainsi qu'on
 * supprime un couplet sans toucher au reste.
 */
export function removeRange(
  track: AudioTrack,
  from: Seconds,
  to: Seconds,
  sourceDuration: Seconds,
): AudioTrack {
  const [start, end] = from <= to ? [from, to] : [to, from];
  const result: AudioSegment[] = [];

  for (const segment of trackSegments(track)) {
    // Hors de l'intervalle: conserve tel quel.
    if (segment.out <= start || segment.in >= end) {
      result.push(segment);
      continue;
    }
    // La partie avant la coupe.
    if (segment.in < start) {
      result.push({ id: newId('seg'), in: segment.in, out: start });
    }
    // La partie apres la coupe.
    if (segment.out > end) {
      result.push({ id: newId('seg'), in: end, out: segment.out });
    }
  }

  return applySegments(track, result, sourceDuration);
}

/**
 * Coupe un segment en deux a l'instant `at`, sans rien retirer.
 *
 * Utile avant de deplacer ou supprimer un passage: la coupe seule est
 * inaudible, mais elle cree la frontiere sur laquelle on agira ensuite.
 */
export function splitAt(
  track: AudioTrack,
  at: Seconds,
  sourceDuration: Seconds,
): AudioTrack {
  const result: AudioSegment[] = [];

  for (const segment of trackSegments(track)) {
    const splitsHere =
      at > segment.in + MIN_SEGMENT_DURATION && at < segment.out - MIN_SEGMENT_DURATION;
    if (splitsHere) {
      result.push({ id: newId('seg'), in: segment.in, out: at });
      result.push({ id: newId('seg'), in: at, out: segment.out });
    } else {
      result.push(segment);
    }
  }

  return applySegments(track, result, sourceDuration);
}

/**
 * Duplique un segment et pose la copie JUSTE APRES l'original.
 *
 * C'est le « copier-coller » d'un passage: repeter un refrain, doubler une
 * mesure. La copie garde les memes bornes source — c'est le meme son — mais
 * s'ajoute a la suite de lecture.
 *
 * N'utilise PAS `applySegments`, contrairement aux autres operations. La
 * normalisation trie par borne d'entree et fusionne les recouvrements: deux
 * segments identiques y seraient immediatement refondus en un seul, et la copie
 * disparaitrait sans laisser de trace. L'ordre des segments est ici porteur de
 * sens (c'est l'ordre de LECTURE), il ne doit pas etre recalcule.
 */
export function duplicateSegment(track: AudioTrack, segmentId: Id): AudioTrack {
  const segments = trackSegments(track);
  const index = segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0) return track;

  const original = segments[index]!;
  const copy: AudioSegment = { ...original, id: newId('seg'), gap: undefined };

  const next = [...segments.slice(0, index + 1), copy, ...segments.slice(index + 1)];

  return {
    ...track,
    // Les bornes globales ne changent pas: la copie reprend une portion deja
    // comprise entre `in` et `out`.
    segments: next,
  };
}

/**
 * Deplace un segment d'un rang dans l'ordre de lecture.
 *
 * `direction` vaut -1 (plus tot) ou +1 (plus tard). Sans effet aux extremites.
 *
 * Meme raison que `duplicateSegment` de ne pas normaliser: reordonner puis
 * trier par borne source annulerait exactement le geste qu'on vient de faire.
 */
export function moveSegment(
  track: AudioTrack,
  segmentId: Id,
  direction: -1 | 1,
): AudioTrack {
  const segments = trackSegments(track);
  const index = segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0) return track;

  const target = index + direction;
  if (target < 0 || target >= segments.length) return track;

  const next = [...segments];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);

  return { ...track, segments: next };
}

/**
 * Supprime un segment par son identifiant. Refuse de vider la piste.
 *
 * `magnet` decide de ce qui arrive au temps libere:
 *
 * - **actif** (defaut): les segments suivants se recollent, la piste raccourcit.
 *   C'est le comportement historique, et celui qu'on veut pour retirer un
 *   passage d'une musique.
 * - **inactif**: le passage retire devient un SILENCE de meme duree, et rien ne
 *   se decale. Indispensable quand la suite de la piste est calee sur l'image:
 *   recoller decalerait tout ce qui vient apres.
 *
 * Le silence est obtenu par un segment MUET (`in === out`), qui ne produit aucun
 * son mais avance le curseur de `scheduleSegments`. Cela evite d'introduire un
 * champ « trou » que toute la chaine audio aurait du apprendre a connaitre.
 */
export function removeSegment(
  track: AudioTrack,
  segmentId: Id,
  sourceDuration: Seconds,
  options: { leaveGap?: boolean } = {},
): AudioTrack {
  const segments = trackSegments(track);
  const removed = segments.find((segment) => segment.id === segmentId);
  const remaining = segments.filter((segment) => segment.id !== segmentId);
  if (!removed || remaining.length === 0) return track;

  /**
   * `leaveGap` tranche pour CETTE suppression, l'aimant n'est que le defaut.
   *
   * Choisir au moment de detruire vaut mieux qu'un reglage pose a l'avance puis
   * oublie: la meme piste contient souvent des passages qu'on veut recoller et
   * d'autres qu'on veut trouer.
   */
  const leaveGap = options.leaveGap ?? track.magnet === false;

  // On recolle: il suffit de retirer le segment.
  if (!leaveGap) return applySegments(track, remaining, sourceDuration);

  /**
   * Aimant inactif: le passage retire devient un SILENCE.
   *
   * On le represente en portant `gap` sur le segment precedent — la duree de vide
   * a inserer APRES lui. `scheduleSegments` avance alors son curseur d'autant
   * sans rien planifier, si bien que tout ce qui suit reste exactement en place.
   *
   * Deux fausses pistes ecartees par la mesure:
   * - decaler `start` de la duree liberee: cela recale bien la SUITE, mais
   *   deplace aussi tout ce qui PRECEDE le passage retire (verifie: le premier
   *   segment passait de 10 s a 12 s);
   * - laisser un segment de duree nulle: `scheduleSegments` l'ecarte par son
   *   garde `available <= 0` et n'avance pas le curseur.
   */
  const freed = removed.out - removed.in;
  const removedIndex = segments.findIndex((segment) => segment.id === segmentId);

  /**
   * Retirer le PREMIER segment: aucun precedent ne peut porter le vide, on
   * decale donc le debut de la piste, ce qui laisse la suite en place.
   *
   * Le `gap` que portait le segment retire doit etre AJOUTE au decalage: sans
   * cela, un silence deja present devant le segment suivant serait perdu et
   * toute la suite remonterait. Cas attrape par un test enchainant deux
   * suppressions.
   */
  if (removedIndex === 0) {
    const shortened = applySegments(track, remaining, sourceDuration);
    return { ...shortened, start: shortened.start + freed + (removed.gap ?? 0) };
  }

  const withGap = segments
    .filter((segment) => segment.id !== segmentId)
    .map((segment, index) =>
      index === removedIndex - 1
        ? { ...segment, gap: (segment.gap ?? 0) + freed }
        : segment,
    );

  return { ...track, segments: withGap, source: track.source };
}

/** Modifie les bornes d'un seul segment. */
export function updateSegment(
  track: AudioTrack,
  segmentId: Id,
  patch: Partial<Pick<AudioSegment, 'in' | 'out'>>,
  sourceDuration: Seconds,
): AudioTrack {
  const updated = trackSegments(track).map((segment) =>
    segment.id === segmentId ? { ...segment, ...patch } : segment,
  );
  return applySegments(track, updated, sourceDuration);
}

/**
 * Ecrit une liste de segments sur la piste apres normalisation.
 *
 * `source` reste synchronise sur le premier segment: le reste du code (grille
 * rythmique, mixage) lit encore ce champ, et le laisser deriver ferait
 * silencieusement decaler la grille des beats.
 */
function applySegments(
  track: AudioTrack,
  segments: readonly AudioSegment[],
  sourceDuration: Seconds,
): AudioTrack {
  const normalized = normalizeSegments(segments, { duration: sourceDuration });
  if (!normalized) return track;

  const first = normalized[0]!;
  const last = normalized[normalized.length - 1]!;

  return {
    ...track,
    source: { in: first.in, out: last.out },
    segments: normalized.length > 1 ? normalized : undefined,
  };
}
