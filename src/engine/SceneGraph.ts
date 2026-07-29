/**
 * Resolution `(Project, temps) -> Scene`.
 *
 * Cette fonction est le pont entre le modele de donnees et le compositeur.
 * Elle est *presque* pure: la seule impurete est l'appel a `MediaCache`, qui
 * fournit les frames. Le meme `buildScene` est utilise par l'apercu et par
 * l'export — seul le cache change.
 */

import {
  clipIndexAt,
  effectiveTransition,
  sourceTimeAt,
  videoDuration,
} from '../domain/timeline';
import { beatInterval, strengthAt } from '../domain/beatmap';
import { lyricOverlays, sungFraction } from '../domain/lyrics';
import type {
  ClipLayer,
  Layer,
  Project,
  Scene,
  Seconds,
  TextLayer,
  TextOverlay,
} from '../domain/types';
import { assetDimensions, type MediaCache } from './MediaCache';
import { clamp01, lastIndexAtOrBefore, progress } from '../lib/math';
import { needsOutgoingFrame } from './transitions';

export function buildScene(project: Project, time: Seconds, cache: MediaCache): Scene {
  const layers: Layer[] = [];

  const clipLayers = buildClipLayers(project, time, cache);
  layers.push(...clipLayers);

  /*
    Les masques passent APRES les clips et AVANT les incrustations.

    Apres les clips, parce qu'ils les recouvrent — c'est le principe meme de la
    decoupe. Avant les textes, parce qu'un masque couvre toute la frame: une
    incrustation posee dessous serait purement et simplement invisible.
  */
  for (const mask of project.textMasks ?? []) {
    if (time < mask.start || time >= mask.start + mask.duration) continue;
    layers.push({ type: 'textMask', mask });
  }

  for (const overlay of project.overlays) {
    const layer = buildTextLayer(project, overlay, time);
    if (layer) layers.push(layer);
  }

  // Les paroles sont converties en incrustations ordinaires: le compositeur n'a
  // donc aucun cas particulier a traiter, et elles beneficient des memes
  // animations et du meme rendu que les textes libres.
  if (project.lyrics) {
    for (const overlay of lyricOverlays(project.lyrics)) {
      const layer = buildTextLayer(project, overlay, time);
      if (layer) layers.push(layer);
    }
  }

  return {
    time,
    frame: project.frame,
    background: project.background,
    layers,
  };
}

function buildClipLayers(project: Project, time: Seconds, cache: MediaCache): ClipLayer[] {
  const { videoTrack } = project;
  const index = clipIndexAt(videoTrack, time);
  if (index < 0) return [];

  const clip = videoTrack.clips[index]!;
  const transition = effectiveTransition(videoTrack.clips, index);

  // La transition d'entree occupe le DEBUT du clip courant.
  const inTransition =
    transition !== null && time < clip.start + transition.duration ? transition : null;

  const layers: ClipLayer[] = [];

  // Clip sortant: seulement pendant une transition qui a besoin des deux images.
  if (inTransition && needsOutgoingFrame(inTransition.type) && index > 0) {
    const previous = videoTrack.clips[index - 1]!;
    const transitionProgress = progress(
      time,
      clip.start,
      clip.start + inTransition.duration,
    );
    // Le clip precedent est fige sur sa derniere frame pendant la transition.
    const previousLayer = makeClipLayer(project, previous, previous.start + previous.duration, cache, {
      transition: {
        type: inTransition.type,
        progress: transitionProgress,
        role: 'outgoing',
        accent: inTransition.accent,
      },
    });
    if (previousLayer) layers.push(previousLayer);
  }

  const currentLayer = makeClipLayer(project, clip, time, cache, {
    transition: inTransition
      ? {
          type: inTransition.type,
          progress: progress(time, clip.start, clip.start + inTransition.duration),
          role: 'incoming',
          accent: inTransition.accent,
        }
      : null,
  });
  if (currentLayer) layers.push(currentLayer);

  return layers;
}

function makeClipLayer(
  project: Project,
  clip: Project['videoTrack']['clips'][number],
  timelineTime: Seconds,
  cache: MediaCache,
  options: { transition: ClipLayer['transition'] },
): ClipLayer | null {
  const asset = project.assets[clip.assetId];
  const sourceTime = sourceTimeAt(clip, timelineTime);
  const source = cache.frameAt(clip.assetId, sourceTime);

  // Pas de frame disponible: on renvoie tout de meme une couche pour que le
  // fond soit dessine, mais sans image. Le compositeur ignore alors la couche.
  const dimensions = source
    ? { width: source.width, height: source.height }
    : assetDimensions(asset, project.frame.width, project.frame.height);

  return {
    type: 'clip',
    clip,
    frame: source?.image ?? null,
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
    opacity: 1,
    clipProgress: progress(timelineTime, clip.start, clip.start + clip.duration),
    transition: options.transition,
  };
}

/**
 * Resout un texte a l'instant `time`, ou `null` s'il n'est pas visible.
 *
 * `progressOut` est exprime en "1 = pleinement visible, 0 = sorti", pour que
 * les etats d'animation se composent par simple multiplication.
 */
function buildTextLayer(
  project: Project,
  overlay: TextOverlay,
  time: Seconds,
): TextLayer | null {
  const end = overlay.start + overlay.duration;
  if (time < overlay.start || time > end) return null;

  const animDuration = Math.min(
    overlay.animation.duration,
    // Une animation ne peut pas depasser la moitie de la duree du texte:
    // sinon l'entree et la sortie se chevauchent et le texte ne s'affiche jamais.
    overlay.duration / 2,
  );

  const progressIn =
    animDuration > 0 ? progress(time, overlay.start, overlay.start + animDuration) : 1;
  const progressOut =
    animDuration > 0 ? 1 - progress(time, end - animDuration, end) : 1;

  return {
    type: 'text',
    overlay,
    progressIn,
    progressOut: clamp01(progressOut),
    pulse: computePulse(project, overlay, time),
    // La progression du karaoke est resolue ICI: le compositeur reste une
    // fonction pure de la scene et ne connait pas le temps. `sungFraction` sait
    // se rabattre sur la duree de la ligne quand les mots ne sont pas horodates.
    sung: overlay.karaoke
      ? sungFraction(
          {
            id: overlay.id,
            text: overlay.text,
            start: overlay.start,
            duration: overlay.duration,
            words: overlay.karaoke.words,
          },
          time,
        )
      : 0,
  };
}

/**
 * Impulsion rythmique d'un texte: une decroissance rapide apres chaque beat.
 *
 * Le beat est exprime en temps source; on convertit en temps timeline via la
 * piste musicale, exactement comme le fait l'aimantation.
 */
function computePulse(project: Project, overlay: TextOverlay, time: Seconds): number {
  if (!overlay.beatPulse?.enabled || !project.beatMap) return 0;

  const music = project.audioTracks.find((track) => track.role === 'music');
  const offset = music ? music.start - music.source.in : 0;
  const sourceTime = time - offset;

  const interval = beatInterval(project.beatMap);
  if (interval <= 0) return 0;

  // La pulsation dure au maximum un tiers d'intervalle: au-dela, elle se
  // confondrait avec la suivante.
  const window = Math.min(0.18, interval / 3);
  const strength = strengthAt(project.beatMap, sourceTime, window);
  if (strength <= 0) return 0;

  // Temps ecoule depuis le beat, normalise sur la fenetre: decroissance lineaire.
  const beats = project.beatMap.beats;
  const index = lastIndexAtOrBefore(beats, sourceTime);
  const elapsed = index >= 0 ? sourceTime - beats[index]! : 0;
  const decay = 1 - clamp01(elapsed / window);
  return strength * decay;
}

/** Duree totale a rendre, en secondes. */
export function sceneDuration(project: Project): Seconds {
  return videoDuration(project.videoTrack);
}

/** Nombre total de frames a encoder pour l'export. */
export function totalFrames(project: Project): number {
  return Math.max(1, Math.ceil(sceneDuration(project) * project.frame.fps));
}
