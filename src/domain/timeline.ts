/**
 * Maths de la timeline. Module PUR: aucun DOM, aucune dependance.
 *
 * Invariant central: les clips d'une piste video sont contigus et sans trou.
 * `clip.start` est un cache derive de l'ordre et des durees, recalcule par
 * `ripple()`. Toute fonction qui modifie l'ordre ou une duree passe par
 * `ripple()`, ce qui rend l'invariant impossible a violer par inadvertance.
 */

import {
  MIN_CLIP_DURATION,
  type Clip,
  type Project,
  type Seconds,
  type Transition,
  type VideoTrack,
} from './types';
import { clamp, quantizeToFrame } from '../lib/math';
import { invariant } from '../lib/assert';

/**
 * Recalcule les `start` a partir de l'ordre du tableau.
 *
 * On accumule en additionnant les durees deja arrondies a la frame plutot
 * qu'en sommant les valeurs brutes: l'erreur flottante ne s'accumule donc pas,
 * et le debut de chaque clip tombe exactement sur une frame.
 */
export function ripple(clips: readonly Clip[], fps: number): Clip[] {
  let cursor = 0;
  return clips.map((clip) => {
    const duration = quantizeToFrame(Math.max(MIN_CLIP_DURATION, clip.duration), fps);
    const next: Clip = { ...clip, start: cursor, duration };
    // Le vide eventuel s'ajoute APRES le clip: le curseur avance donc de la
    // duree PLUS le vide. Meme regle que `scheduleSegments` pour l'audio.
    cursor = quantizeToFrame(cursor + duration + Math.max(0, clip.gap ?? 0), fps);
    return next;
  });
}

/** Applique `ripple` a la piste video d'un projet. */
export function rippleTrack(track: VideoTrack, fps: number): VideoTrack {
  return { ...track, clips: ripple(track.clips, fps) };
}

/**
 * Duree totale de la piste video, en secondes.
 *
 * Le vide porte par le DERNIER clip ne compte pas: un montage ne se termine pas
 * sur du noir, et l'inclure allongerait l'export d'un silence involontaire.
 */
export function videoDuration(track: VideoTrack): Seconds {
  const last = track.clips[track.clips.length - 1];
  return last ? last.start + last.duration : 0;
}

/**
 * Duree totale du projet.
 *
 * L'audio peut depasser la video (musique plus longue que le montage): la
 * duree exportee est celle de la video, car un reel se termine sur l'image.
 * Un projet sans clip mais avec de l'audio a donc une duree nulle.
 */
export function totalDuration(project: Project): Seconds {
  return videoDuration(project.videoTrack);
}

/** Index du clip actif a l'instant `time`, ou -1 en dehors de la timeline. */
export function clipIndexAt(track: VideoTrack, time: Seconds): number {
  const { clips } = track;
  if (clips.length === 0) return -1;

  let low = 0;
  let high = clips.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const clip = clips[mid]!;
    if (time < clip.start) {
      high = mid - 1;
    } else if (time >= clip.start + clip.duration) {
      low = mid + 1;
    } else {
      return mid;
    }
  }
  // `time` peut valoir exactement la duree totale (fin de lecture): on renvoie
  // alors le dernier clip plutot que -1, pour que la derniere frame existe.
  //
  // On ne le fait que si `time` tombe dans le dernier clip ou juste apres sa
  // fin: un VIDE en tete de timeline ne doit pas afficher le dernier plan.
  const last = clips.length - 1;
  const lastClip = clips[last]!;
  return time >= lastClip.start + lastClip.duration ? last : -1;
}

export function clipAt(track: VideoTrack, time: Seconds): Clip | undefined {
  const index = clipIndexAt(track, time);
  return index >= 0 ? track.clips[index] : undefined;
}

/**
 * Temps dans la SOURCE correspondant a un instant de la timeline.
 * Pour une image, la notion n'a pas de sens et on renvoie 0.
 */
export function sourceTimeAt(clip: Clip, timelineTime: Seconds): Seconds {
  if (!clip.source) return 0;
  const elapsed = clamp(timelineTime - clip.start, 0, clip.duration);
  const { in: inPoint, out: outPoint, speed } = clip.source;
  const sourceTime = inPoint + elapsed * speed;
  // On borne a `out` pour ne jamais decoder au-dela de l'extrait choisi.
  return clamp(sourceTime, inPoint, Math.max(inPoint, outPoint));
}

/**
 * Duree maximale autorisee pour la transition d'entree d'un clip.
 * Une transition ne peut jamais consommer plus de la moitie du plus court des
 * deux clips voisins: au-dela, elle mangerait entierement un clip.
 */
export function maxTransitionDuration(clips: readonly Clip[], index: number): Seconds {
  const current = clips[index];
  if (!current || index === 0) return 0;
  const previous = clips[index - 1]!;
  return Math.min(current.duration, previous.duration) / 2;
}

/**
 * Duree de transition tenable par TOUS les clips du montage.
 *
 * Le minimum et non le maximum: une transition plus longue que le plan le plus
 * court serait rognee a l'affichage par `effectiveTransition`, et le curseur
 * afficherait alors une valeur que le montage ne respecte pas.
 *
 * Le premier clip est exclu du calcul — il n'a rien avant lui, donc sa borne
 * vaut zero et ecraserait le minimum a chaque fois.
 */
export function uniformTransitionLimit(clips: readonly Clip[]): Seconds {
  if (clips.length < 2) return 0;
  let limit = Infinity;
  for (let index = 1; index < clips.length; index++) {
    limit = Math.min(limit, maxTransitionDuration(clips, index));
  }
  return Number.isFinite(limit) ? limit : 0;
}

/** Transition d'entree effective d'un clip, deja bornee. */
export function effectiveTransition(
  clips: readonly Clip[],
  index: number,
): Transition | null {
  const clip = clips[index];
  if (!clip?.transitionIn || clip.transitionIn.type === 'none' || index === 0) return null;
  const duration = Math.min(clip.transitionIn.duration, maxTransitionDuration(clips, index));
  if (duration <= 0) return null;
  /*
    On ETEND la transition d'origine au lieu de la reconstruire champ par champ.

    Piege attrape par une sonde de rendu: enumerer `{ type, duration }` laissait
    tomber `accent`, si bien qu'un effet cumule etait silencieusement ignore a
    l'apercu comme a l'export. Tout champ ajoute plus tard a `Transition`
    disparaitrait de la meme facon — seule la duree doit etre remplacee ici.
  */
  return { ...clip.transitionIn, duration };
}

// ---------------------------------------------------------------------------
// Operations d'edition. Toutes renvoient une NOUVELLE piste rippled.
// ---------------------------------------------------------------------------

export function insertClip(
  track: VideoTrack,
  clip: Clip,
  index: number,
  fps: number,
): VideoTrack {
  const clips = [...track.clips];
  const position = clamp(index, 0, clips.length);
  clips.splice(position, 0, clip);
  return { ...track, clips: ripple(clips, fps) };
}

export function appendClip(track: VideoTrack, clip: Clip, fps: number): VideoTrack {
  return insertClip(track, clip, track.clips.length, fps);
}

/**
 * Retire un clip.
 *
 * `leaveGap` decide du sort du temps libere:
 *
 * - **false** (defaut): les plans suivants remontent, le montage raccourcit.
 * - **true**: un VIDE de la duree du plan retire reste en place, et rien ne se
 *   decale. Indispensable quand le son ou le texte sont cales sur ce qui suit —
 *   recoller decalerait alors tout le montage.
 *
 * Le vide est porte par le clip PRECEDENT (`gap`). Retirer le premier clip est
 * donc le seul cas ou il n'y a pas de porteur: le vide serait en tete de
 * timeline, ou il n'a pas de sens (le montage commencerait par du noir). On
 * recolle alors, comme le ferait `leaveGap: false`.
 */
export function removeClip(
  track: VideoTrack,
  clipId: string,
  fps: number,
  options: { leaveGap?: boolean } = {},
): VideoTrack {
  const index = track.clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return track;

  const removed = track.clips[index]!;
  const clips = track.clips.filter((clip) => clip.id !== clipId);

  if (options.leaveGap === true && index > 0) {
    // Le vide du clip retire s'ajoute a celui qu'il portait deja, sinon un
    // silence existant devant le clip suivant serait perdu.
    const freed = removed.duration + Math.max(0, removed.gap ?? 0);
    const previous = clips[index - 1]!;
    clips[index - 1] = { ...previous, gap: Math.max(0, previous.gap ?? 0) + freed };
  }

  return { ...track, clips: ripple(clips, fps) };
}

export function moveClip(track: VideoTrack, from: number, to: number, fps: number): VideoTrack {
  const clips = [...track.clips];
  invariant(from >= 0 && from < clips.length, `index source ${from} invalide`);
  const target = clamp(to, 0, clips.length - 1);
  const [moved] = clips.splice(from, 1);
  invariant(moved !== undefined, 'clip deplace introuvable');
  clips.splice(target, 0, moved);
  return { ...track, clips: ripple(clips, fps) };
}

/**
 * Fixe la duree d'un clip sur la timeline.
 *
 * Pour un clip video, la duree ne peut pas depasser l'extrait source
 * disponible (`out - in`, corrige de la vitesse): sinon on afficherait une
 * frame gelee en fin de clip.
 */
export function setClipDuration(
  track: VideoTrack,
  clipId: string,
  duration: Seconds,
  fps: number,
): VideoTrack {
  const clips = track.clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    const upperBound = clip.source
      ? (clip.source.out - clip.source.in) / clip.source.speed
      : Number.POSITIVE_INFINITY;
    const next = clamp(duration, MIN_CLIP_DURATION, upperBound);
    // Un trim manuel casse l'aimantation: la duree n'est plus dictee par le beat.
    return { ...clip, duration: next, beatLocked: false };
  });
  return { ...track, clips: ripple(clips, fps) };
}

/**
 * Trim du point d'entree d'un clip video: deplace `source.in` et raccourcit
 * d'autant la duree, de sorte que la frame affichee au debut change mais que
 * la fin du clip reste sur le meme contenu.
 */
export function trimClipStart(
  track: VideoTrack,
  clipId: string,
  deltaSeconds: Seconds,
  fps: number,
): VideoTrack {
  const clips = track.clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    if (!clip.source) {
      // Une image n'a pas de point d'entree: on ajuste seulement la duree.
      return {
        ...clip,
        duration: Math.max(MIN_CLIP_DURATION, clip.duration - deltaSeconds),
        beatLocked: false,
      };
    }
    const { in: inPoint, out: outPoint, speed } = clip.source;
    const maxDelta = clip.duration - MIN_CLIP_DURATION;
    const delta = clamp(deltaSeconds, -inPoint / speed, maxDelta);
    const nextIn = clamp(inPoint + delta * speed, 0, outPoint - MIN_CLIP_DURATION * speed);
    return {
      ...clip,
      source: { in: nextIn, out: outPoint, speed },
      duration: Math.max(MIN_CLIP_DURATION, clip.duration - delta),
      beatLocked: false,
    };
  });
  return { ...track, clips: ripple(clips, fps) };
}

/**
 * Trim du point de sortie: allonge ou raccourcit la fin du clip.
 *
 * `source.out` est fixe a l'import (il vaut la fin de l'extrait disponible),
 * donc trimmer la fin revient a changer la duree — `setClipDuration` la borne
 * deja a l'extrait source disponible.
 */
export function trimClipEnd(
  track: VideoTrack,
  clipId: string,
  deltaSeconds: Seconds,
  fps: number,
): VideoTrack {
  const clip = track.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return track;
  return setClipDuration(track, clipId, clip.duration + deltaSeconds, fps);
}

/**
 * Coupe un clip en deux a l'instant TIMELINE `at`.
 *
 * Les deux morceaux se suivent sans trou et couvrent exactement la duree de
 * l'original: le montage garde donc la meme longueur, et rien ne se decale. On
 * ne coupe que si les DEUX morceaux restent au-dessus de la duree minimale —
 * produire un fragment d'une frame serait inutilisable.
 *
 * Pour une video, le point d'entree du second morceau avance dans la source a
 * proportion de la vitesse: sans cela la coupe rejouerait le debut de l'extrait
 * au lieu de continuer. Une image n'a pas de source, seule sa duree est partagee.
 *
 * `beatLocked` est efface sur les deux morceaux: leurs durees ne sont plus celles
 * posees par l'aimantation, et laisser le liseré chartreuse serait mensonger.
 */
export function splitClipAt(
  track: VideoTrack,
  at: Seconds,
  newClipId: string,
  fps: number,
): VideoTrack {
  const index = clipIndexAt(track, at);
  if (index < 0) return track;

  const clip = track.clips[index]!;
  const into = at - clip.start;

  // Les deux morceaux doivent rester exploitables.
  if (into < MIN_CLIP_DURATION || clip.duration - into < MIN_CLIP_DURATION) return track;

  const first: Clip = {
    ...clip,
    duration: into,
    beatLocked: false,
    // La transition d'entree reste sur le premier morceau: c'est lui qui
    // commence la ou l'original commencait.
  };

  const second: Clip = {
    ...clip,
    id: newClipId,
    start: clip.start + into,
    duration: clip.duration - into,
    beatLocked: false,
    // Pas de transition d'entree sur le second: une coupe franche est ce qu'on
    // attend d'un decoupage, et heriter du fondu de l'original le rejouerait au
    // milieu du plan.
    transitionIn: undefined,
    source: clip.source
      ? {
          ...clip.source,
          // `into` est une duree de timeline; la source avance de `into * speed`.
          in: clip.source.in + into * clip.source.speed,
        }
      : undefined,
  };

  const clips = [...track.clips];
  clips.splice(index, 1, first, second);
  return { ...track, clips: ripple(clips, fps) };
}

/** Duplique un clip juste apres l'original. */
export function duplicateClip(
  track: VideoTrack,
  clipId: string,
  newClipId: string,
  fps: number,
): VideoTrack {
  const index = track.clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return track;
  const source = track.clips[index]!;
  return insertClip(track, { ...source, id: newClipId }, index + 1, fps);
}

/** Applique la meme duree a tous les clips (utilise par les modeles). */
export function setUniformDuration(
  track: VideoTrack,
  duration: Seconds,
  fps: number,
): VideoTrack {
  const safe = Math.max(MIN_CLIP_DURATION, duration);
  return {
    ...track,
    clips: ripple(
      track.clips.map((clip) => ({ ...clip, duration: safe, beatLocked: false })),
      fps,
    ),
  };
}

// ---------------------------------------------------------------------------
// Verification d'invariants (utilisee en dev et dans les tests)
// ---------------------------------------------------------------------------

export function assertTrackInvariants(track: VideoTrack, fps: number): void {
  const tolerance = 1 / (fps * 1000);
  let expected = 0;
  track.clips.forEach((clip, index) => {
    invariant(clip.duration >= MIN_CLIP_DURATION - tolerance, `clip ${index}: duree trop courte`);
    invariant(
      Math.abs(clip.start - expected) < tolerance,
      `clip ${index}: start ${clip.start} attendu ${expected} (piste non contigue)`,
    );
    const transition = clip.transitionIn;
    if (transition && transition.type !== 'none' && index > 0) {
      invariant(
        transition.duration <= maxTransitionDuration(track.clips, index) + tolerance,
        `clip ${index}: transition trop longue`,
      );
    }
    invariant((clip.gap ?? 0) >= 0, `clip ${index}: vide negatif`);
    // Le vide fait partie de la position attendue du clip suivant: la piste
    // reste « contigue » au sens ou chaque debut se deduit du precedent.
    expected = quantizeToFrame(expected + clip.duration + Math.max(0, clip.gap ?? 0), fps);
  });
}
