/**
 * Application d'un modele de montage. Module PUR.
 *
 * La recette vivait dans `TemplateGallery.apply()`, donc dans un composant —
 * intestable, le projet n'utilisant deliberement aucune bibliotheque de rendu de
 * composants. Elle est ici une fonction de `(Project, Template) -> Project`.
 *
 * Aucun acces au store, aucune generation d'identifiant: la grille rythmique est
 * FOURNIE par l'appelant. `timelineGrid` a besoin de la piste musicale et de la
 * division, ce qui ferait entrer le store dans le domaine si on la derivait ici.
 * La passer resolue rend aussi la fonction triviale a tester: on lui donne
 * [0, 0.5, 1, ...] et on verifie les durees obtenues.
 */

import { distributeTrackOnBeats } from './snapping';
import { setUniformDuration, videoDuration } from './timeline';
import type {
  BeatDivision,
  Project,
  Seconds,
  TextPreset,
  Transition,
  TransitionType,
  VideoTrack,
} from './types';

/**
 * Recette de montage, purement declarative.
 *
 * Le TYPE vit dans le domaine, le CATALOGUE dans `features/samples/templates.ts`.
 * La separation n'est pas cosmetique: `applyTemplate` doit pouvoir consommer un
 * modele sans que le domaine ne depende de `features/`, ce qui inverserait la
 * direction des dependances de tout le projet.
 */
export interface Template {
  id: string;
  /** Cles i18n completes: verifiees a la compilation, comme pour les samples. */
  nameKey: 'samples:templates.beatSlideshow.name'
    | 'samples:templates.cinematicTravel.name'
    | 'samples:templates.quickCuts.name'
    | 'samples:templates.countdown.name'
    | 'samples:templates.beforeAfter.name';
  descriptionKey: 'samples:templates.beatSlideshow.description'
    | 'samples:templates.cinematicTravel.description'
    | 'samples:templates.quickCuts.description'
    | 'samples:templates.countdown.description'
    | 'samples:templates.beforeAfter.description';
  /** Duree cible du reel, en secondes. */
  targetDuration: number;
  /** Nombre de plans recommande. Informatif: ne pilote aucune mutation. */
  suggestedClips: number;
  /** Decoupe rythmique a appliquer si une analyse est disponible. */
  division: BeatDivision;
  /** Un clip tous les N points de grille. */
  everyN: number;
  transition: { type: TransitionType; duration: number };
  /** Duree par clip quand aucun rythme n'est detecte. */
  fallbackClipDuration: number;
  kenBurns: boolean;
  /**
   * Boucle generee assortie au tempo du modele, posee sur un projet SANS
   * musique. Voir `useApplyTemplate` pour la garde.
   */
  suggestedSampleId?: string;
  /**
   * Style de texte du modele.
   *
   * Declare mais volontairement NON LU pour l'instant: `TextOverlay.text` est du
   * contenu saisi par l'utilisateur, jamais une chaine venue de l'application.
   * Faire naitre des incrustations depuis un modele demande de trancher d'ou
   * vient leur texte — question ouverte, pas un oubli.
   */
  textPreset: TextPreset;
}

/** Zoom lent pose par un modele. Meme valeur que le bouton du panneau Effets. */
const KEN_BURNS_SCALE = 1.12;

/**
 * Ecart tolere entre le nombre de plans reel et celui que le modele suppose.
 *
 * 0,5 = « moitie moins » et 2 = « deux fois plus ». En deca, le resultat reste
 * conforme a l'intention du modele; au-dela, il ne l'est plus — un « Coupes
 * rapides » prevu pour 16 plans applique a 2 photos ne produit pas des coupes
 * rapides, il produit deux plans longs.
 */
const CLIP_MISMATCH_LOW = 0.5;
const CLIP_MISMATCH_HIGH = 2;

export interface ApplyTemplateOptions {
  /**
   * Grille rythmique en temps TIMELINE, ou tableau vide si aucune analyse.
   * Vient de `timelineGrid(beatMap, musicTrack(project), template.division)`.
   */
  grid: readonly Seconds[];
  fps: number;
}

export interface TemplatePlan {
  clipCount: number;
  /** Duree du montage une fois le modele applique. */
  resultingDuration: Seconds;
  /** Vrai si les coupes tomberont sur le rythme plutot qu'a intervalle fixe. */
  onBeat: boolean;
  clipMismatch: 'tooFew' | 'tooMany' | 'ok';
}

/**
 * Ce que fera le modele, SANS rien modifier.
 *
 * Sert a expliquer avant d'agir: un modele qui reorganise tout un montage
 * merite d'annoncer son effet plutot que de le reveler apres coup.
 */
export function planTemplate(
  project: Project,
  template: Template,
  options: ApplyTemplateOptions,
): TemplatePlan {
  const clipCount = project.videoTrack.clips.length;
  const applied = applyTemplate(project, template, options);

  let clipMismatch: TemplatePlan['clipMismatch'] = 'ok';
  if (clipCount > 0) {
    const ratio = clipCount / template.suggestedClips;
    if (ratio < CLIP_MISMATCH_LOW) clipMismatch = 'tooFew';
    else if (ratio > CLIP_MISMATCH_HIGH) clipMismatch = 'tooMany';
  }

  return {
    clipCount,
    resultingDuration: videoDuration(applied.videoTrack),
    onBeat: clipCount > 0 && options.grid.length > 0,
    clipMismatch,
  };
}

/**
 * Applique un modele.
 *
 * L'ORDRE n'est pas negociable, et il est repris tel quel de l'ancienne
 * galerie:
 *
 *   1. transitions — bornees par les durees de clip, donc posees AVANT la
 *      repartition: l'inverse provoquerait un ecretage inutile;
 *   2. cadence     — sur le rythme si une grille existe, sinon duree uniforme;
 *   3. zoom lent   — clip par clip;
 *   4. snapping    — le reglage du projet suit la division du modele.
 */
export function applyTemplate(
  project: Project,
  template: Template,
  options: ApplyTemplateOptions,
): Project {
  // Un projet sans plan traverse sans erreur: c'est le chemin « demarrer avec ce
  // modele », ou les reglages sont poses avant l'import des photos.
  if (project.videoTrack.clips.length === 0) {
    return {
      ...project,
      snapping: { ...project.snapping, division: template.division, enabled: true },
    };
  }

  let track = withTransitions(project.videoTrack, template.transition);
  track = withCadence(track, template, options);
  track = withKenBurns(track, template.kenBurns);

  return {
    ...project,
    videoTrack: track,
    snapping: { ...project.snapping, division: template.division, enabled: true },
  };
}

/**
 * Transition d'entree sur tous les plans SAUF le premier.
 *
 * Meme regle que `setTransitionForAll`: le premier plan n'a rien avant lui, donc
 * aucune transition d'entree n'a de sens.
 */
function withTransitions(track: VideoTrack, transition: Transition): VideoTrack {
  const none = transition.type === 'none';
  return {
    ...track,
    clips: track.clips.map((clip, index) => ({
      ...clip,
      transitionIn: index === 0 || none ? undefined : { ...transition },
    })),
  };
}

/** Coupes sur le rythme si la grille le permet, sinon durees egales. */
function withCadence(
  track: VideoTrack,
  template: Template,
  options: ApplyTemplateOptions,
): VideoTrack {
  if (options.grid.length > 0) {
    // `fps` est indispensable: sans lui, `quantizeToFrame` renvoie NaN et toutes
    // les durees deviennent invalides — attrape par un test.
    return distributeTrackOnBeats(track, options.grid, {
      division: template.division,
      mode: 'everyN',
      n: template.everyN,
      fps: options.fps,
    });
  }

  /*
    Sans rythme, on repartit la duree CIBLE du modele sur les plans presents,
    et non `fallbackClipDuration`: ce dernier suppose le nombre de plans
    recommande. Avec 4 photos pour un modele qui en attend 8, s'en tenir a la
    duree par plan produirait un reel deux fois trop court.
  */
  const perClip = template.targetDuration / track.clips.length;
  return setUniformDuration(track, perClip, options.fps);
}

/**
 * Pose ou EFFACE le zoom lent.
 *
 * L'effacement compte autant que la pose: enchainer « Coupes rapides » apres
 * « Voyage cinematique » doit retirer le zoom, sinon le modele n'est pas
 * applique, il est superpose.
 */
function withKenBurns(track: VideoTrack, enabled: boolean): VideoTrack {
  return {
    ...track,
    clips: track.clips.map((clip) => ({
      ...clip,
      kenBurns: enabled ? { toScale: KEN_BURNS_SCALE, toX: 0, toY: 0 } : undefined,
    })),
  };
}

/**
 * Bornes des coupes, en fraction de la duree totale.
 *
 * Dans le domaine parce que le SCHEMA de la vignette et l'APERCU anime doivent
 * decrire la meme cadence. Deux calculs separes divergeraient — le meme
 * raisonnement que pour `offsetLimitFor`, partage entre le panneau Modifier et
 * le geste de recadrage.
 *
 * Renvoie les instants de coupe INTERNES, sans 0 ni 1: ce sont des jointures
 * entre plans, et les bords du schema n'en sont pas.
 */
export function templateCutMarks(template: Template): readonly number[] {
  const count = Math.max(1, Math.round(template.suggestedClips));
  const marks: number[] = [];
  for (let index = 1; index < count; index += 1) {
    marks.push(index / count);
  }
  return marks;
}
