/**
 * Mixage audio pour l'export.
 *
 * Tout passe par un unique `OfflineAudioContext`: le rendu est plus rapide que
 * le temps reel et surtout DETERMINISTE (le meme projet donne exactement le
 * meme mix, quel que soit l'appareil). C'est ce qui rend l'export testable.
 */

import { scheduleSegments, segmentsDuration, trackSegments } from '../domain/audioEdit';
import type { AudioTrack, Project, Seconds } from '../domain/types';

/** 48 kHz stereo: le taux attendu par l'encodeur AAC. */
export const MIX_SAMPLE_RATE = 48_000;
export const MIX_CHANNELS = 2;

export type DecodedAudio = ReadonlyMap<string, AudioBuffer>;

/**
 * Produit le mix final, de duree exactement `duration`.
 *
 * Renvoie `null` si le projet n'a aucune piste audible: on n'ajoute alors pas
 * de piste audio au MP4 du tout, plutot qu'une piste silencieuse.
 */
export async function mixdown(
  project: Project,
  buffers: DecodedAudio,
  duration: Seconds,
): Promise<AudioBuffer | null> {
  const audible = project.audioTracks.filter(
    (track) => !track.muted && track.gain > 0 && buffers.has(track.assetId),
  );
  if (audible.length === 0 || duration <= 0) return null;

  const frameCount = Math.ceil(duration * MIX_SAMPLE_RATE);
  const context = new OfflineAudioContext(MIX_CHANNELS, frameCount, MIX_SAMPLE_RATE);

  // Limiteur doux en sortie: quand musique et voix s'additionnent, la somme
  // depasse facilement 0 dBFS et l'export saturerait.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;
  limiter.connect(context.destination);

  for (const track of audible) {
    const buffer = buffers.get(track.assetId);
    if (buffer) scheduleTrack(context, limiter, track, buffer, duration);
  }

  return context.startRendering();
}

/**
 * Planifie une piste, segment par segment.
 *
 * Les segments sont joues bout a bout: un passage retire par l'utilisateur
 * n'occupe aucune place sur la timeline. Un seul `GainNode` porte l'enveloppe de
 * toute la piste, afin que les fondus d'entree et de sortie s'appliquent au
 * montage audio complet et non a chaque morceau — sinon chaque coupe
 * s'entendrait comme un fondu.
 */
function scheduleTrack(
  context: OfflineAudioContext,
  destination: AudioNode,
  track: AudioTrack,
  buffer: AudioBuffer,
  totalDuration: Seconds,
): void {
  // Une piste qui commence apres la fin du reel n'est jamais entendue.
  if (track.start >= totalDuration) return;

  const scheduled = scheduleSegments(track, {
    from: 0,
    until: totalDuration,
    sourceDuration: buffer.duration,
  });
  if (scheduled.length === 0) return;

  const audibleDuration = Math.min(
    segmentsDuration(trackSegments(track)),
    totalDuration - track.start,
  );

  const gain = context.createGain();
  applyEnvelope(gain.gain, track, track.start, audibleDuration);
  gain.connect(destination);

  for (const segment of scheduled) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(segment.at, segment.offset, segment.duration);
  }
}

/**
 * Volume et fondus par automation de parametre.
 *
 * On evite `linearRampToValueAtTime(0, …)`: descendre exactement a zero produit
 * parfois un clic. On s'arrete a -80 dB, inaudible.
 */
function applyEnvelope(
  param: AudioParam,
  track: AudioTrack,
  startAt: Seconds,
  duration: Seconds,
): void {
  const target = track.gain;
  const silence = 0.0001;

  // Les fondus ne peuvent pas se chevaucher: on les borne a la moitie de la piste.
  const fadeIn = Math.min(track.fadeIn, duration / 2);
  const fadeOut = Math.min(track.fadeOut, duration / 2);

  if (fadeIn > 0) {
    param.setValueAtTime(silence, startAt);
    param.linearRampToValueAtTime(target, startAt + fadeIn);
  } else {
    param.setValueAtTime(target, startAt);
  }

  if (fadeOut > 0) {
    const fadeOutStart = startAt + duration - fadeOut;
    param.setValueAtTime(target, fadeOutStart);
    param.linearRampToValueAtTime(silence, startAt + duration);
  }
}

/**
 * Decode un blob audio en `AudioBuffer`.
 *
 * `decodeAudioData` consomme l'ArrayBuffer passe: on lui donne toujours une
 * copie fraiche, sinon un second decodage du meme fichier echouerait.
 */
export async function decodeAudioBlob(
  blob: Blob,
  context: BaseAudioContext,
): Promise<AudioBuffer> {
  const bytes = await blob.arrayBuffer();
  return context.decodeAudioData(bytes);
}

/** Reduit un buffer multi-canal en mono, pour l'analyse rythmique. */
export function toMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;

  if (channels === 1) {
    // On copie: l'appelant peut transferer le tableau vers un worker.
    return buffer.getChannelData(0).slice();
  }

  const mono = new Float32Array(length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      mono[i] = mono[i]! + data[i]!;
    }
  }
  for (let i = 0; i < length; i += 1) {
    mono[i] = mono[i]! / channels;
  }
  return mono;
}
