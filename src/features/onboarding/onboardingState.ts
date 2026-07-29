/**
 * Logique de l'ecran de demarrage. Module PUR: aucun DOM, aucun React.
 *
 * L'etat des trois cartes est DEDUIT du projet a chaque rendu, jamais memorise.
 * C'est indispensable: `setMusic` remet `beatMap` a `undefined` (l'analyse
 * portait sur l'ancienne musique). Un booleen local « etape 3 faite »
 * survivrait a cet effacement et afficherait une coche pour une analyse qui
 * n'existe plus.
 */

import { musicTrack } from '../../domain/project';
import type { Project } from '../../domain/types';

/** L'etape en cours d'execution, ou `null` si rien ne tourne. */
export type BusyStep = 'media' | 'audio' | 'beat';

export type StepState =
  /** Rien n'a encore ete fait: la carte invite a agir. */
  | 'idle'
  /** Operation en cours sur cette carte. */
  | 'busy'
  /** Etape accomplie. */
  | 'done'
  /** Etape impossible pour l'instant (prerequis manquant). */
  | 'disabled';

export interface OnboardingSteps {
  media: StepState;
  audio: StepState;
  beat: StepState;
}

/**
 * Un projet est vide s'il n'a ni clip, ni piste audio, ni media importe.
 *
 * Sert a deux choses: decider d'afficher l'ecran de demarrage a l'ouverture, et
 * savoir si « Nouveau » doit demander confirmation.
 */
export function isProjectEmpty(project: Project): boolean {
  return (
    project.videoTrack.clips.length === 0 &&
    project.audioTracks.length === 0 &&
    Object.keys(project.assets).length === 0
  );
}

/**
 * Etat des trois cartes.
 *
 * `busy` l'emporte sur tout pour l'etape concernee: une operation en cours doit
 * se voir, meme si l'etape etait deja accomplie (cas d'un remplacement).
 *
 * L'etape 3 est `disabled` sans musique — il n'y a rien a analyser. Elle n'est
 * en revanche PAS desactivee en l'absence de clip: `distributeOnBeats` serait
 * alors un no-op silencieux, ce qui ressemblerait a une panne. L'appelant pose
 * un garde-fou et explique par un message.
 */
export function deriveSteps(project: Project, busy: BusyStep | null): OnboardingSteps {
  const hasClips = project.videoTrack.clips.length > 0;
  const hasMusic = musicTrack(project) !== undefined;
  const hasBeat = project.beatMap !== undefined;

  return {
    media: busy === 'media' ? 'busy' : hasClips ? 'done' : 'idle',
    audio: busy === 'audio' ? 'busy' : hasMusic ? 'done' : 'idle',
    beat:
      busy === 'beat'
        ? 'busy'
        : !hasMusic
          ? 'disabled'
          : hasBeat
            ? 'done'
            : 'idle',
  };
}
