/**
 * Extraction de la bande son d'une video, et export d'une piste en fichier.
 *
 * Deux operations symetriques, reunies parce qu'elles partagent le meme
 * pipeline mediabunny et les memes contraintes de codec.
 *
 * POURQUOI PAS DU MP3 — mesure dans Chromium, sur l'origine reelle de
 * l'application:
 *
 *   AudioEncoder.isConfigSupported({ codec: 'mp3' })   -> supported: false
 *   AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2' }) -> supported: true
 *   AudioEncoder.isConfigSupported({ codec: 'opus' })  -> supported: true
 *
 * Aucun navigateur n'embarque d'encodeur MP3 — heritage des brevets, qui a
 * laisse les moteurs decoder le format sans jamais l'ecrire. Les seules voies
 * seraient un encodeur WebAssembly de plusieurs mega-octets (meme objection que
 * la transcription, voir CLAUDE.md) ou un service distant, qui contredirait la
 * promesse « rien ne quitte votre appareil ».
 *
 * On exporte donc en **M4A/AAC**: lu partout — iOS, Android, Windows, macOS,
 * WhatsApp, Instagram — et reellement produisible par le navigateur.
 */

import { ImportError } from '../import/importMedia';
import type { MediaAsset } from '../../domain/types';

/** Format du fichier produit par l'export d'une piste. */
export const AUDIO_EXPORT_MIME = 'audio/mp4';
export const AUDIO_EXPORT_EXTENSION = 'm4a';

/**
 * Debit de l'AAC, en bits par seconde.
 *
 * Ne sert QUE la ou un reencodage est inevitable — l'export d'une piste
 * decoupee, qui doit etre rendue avant d'etre ecrite. L'extraction, elle,
 * recopie et n'a donc pas de debit a choisir.
 *
 * 192 kbit/s: au-dela, l'AAC n'apporte plus de difference audible sur de la
 * musique, et le fichier grossit pour rien sur un telephone.
 */
export const AUDIO_BITRATE = 192_000;

/**
 * Extrait la piste sonore d'un fichier video, en un blob audio autonome.
 *
 * SANS PERTE quand c'est possible. La piste audio d'une video est le plus
 * souvent deja en AAC dans un conteneur MP4: mediabunny la RECOPIE alors telle
 * quelle, octet pour octet, sans la decoder ni la reencoder. Le fichier obtenu
 * a exactement la qualite de l'original.
 *
 * Le reencodage n'a lieu que si le codec source ne rentre pas dans un MP4 —
 * Opus d'un WebM, Vorbis d'un OGG, PCM d'un MOV. C'est mediabunny qui tranche,
 * d'ou l'absence de `forceTranscode`: le lui imposer ajouterait une generation
 * de perte au cas le plus frequent, celui ou aucune n'est necessaire.
 *
 * Le `bitrate` ne sert donc que de repli, quand un reencodage est inevitable.
 */
export async function extractAudioFromVideo(file: File): Promise<Blob> {
  const {
    ALL_FORMATS,
    BlobSource,
    Input,
    Output,
    BufferTarget,
    Mp4OutputFormat,
    Conversion,
  } = await import('mediabunny');

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new ImportError('errors:import.noAudioTrack');

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

  /*
    `Conversion` plutot qu'une boucle de paquets ecrite a la main: il gere le
    choix du codec, la mise en tampon et la contre-pression. On lui retire la
    video, ce qui fait de la sortie un fichier purement audio.
  */
  /*
    AUCUNE option de codec sur l'audio.

    Mesure (voir `tests/browser/extractAudio.test.ts`): preciser
    `{ codec: 'aac', bitrate }` force le transcodage MEME quand la source est
    deja de l'AAC — ecart mesure de 1,9e-2 sur les echantillons decodes, soit
    une generation de perte a chaque extraction. Sans ces options, mediabunny
    recopie la piste telle quelle des qu'elle rentre dans le conteneur, et
    l'ecart tombe a zero.
  */
  const conversion = await Conversion.init({
    input,
    output,
    video: { discard: true },
  });

  await conversion.execute();

  const buffer = output.target.buffer;
  if (!buffer) throw new ImportError('errors:import.decodeFailed');

  return new Blob([buffer], { type: AUDIO_EXPORT_MIME });
}

/**
 * Ecrit un `AudioBuffer` deja monte en fichier M4A.
 *
 * Ici le reencodage est INEVITABLE, contrairement a l'extraction: une piste
 * decoupee, reordonnee et mixee n'existe nulle part sous forme de flux encode.
 * Il faut la rendre en echantillons, puis les encoder une fois.
 *
 * Une seule generation, a 192 kbit/s. Le montage lui-meme reste non destructif:
 * le projet ne conserve que des bornes temporelles, et la source d'origine
 * n'est jamais reecrite — on peut donc reexporter autant de fois qu'on veut
 * sans jamais empiler les pertes.
 */
export async function encodeAudioBuffer(buffer: AudioBuffer): Promise<Blob> {
  const { AudioBufferSource, Output, BufferTarget, Mp4OutputFormat } = await import('mediabunny');

  const source = new AudioBufferSource({ codec: 'aac', bitrate: AUDIO_BITRATE });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  output.addAudioTrack(source);

  await output.start();
  // `await` sur `add`: c'est la contre-pression qui borne la memoire, meme
  // regle que l'export video.
  await source.add(buffer);
  source.close();
  await output.finalize();

  const result = output.target.buffer;
  if (!result) throw new ImportError('errors:import.decodeFailed');

  return new Blob([result], { type: AUDIO_EXPORT_MIME });
}

/**
 * Nom de fichier propose pour l'audio extrait d'une video.
 *
 * On repart du nom d'origine prive de son extension: retrouver « vacances.m4a »
 * a cote de « vacances.mp4 » est ce qu'on attend, la ou un nom genere serait a
 * renommer a la main.
 */
export function audioNameFor(asset: MediaAsset | { name: string }): string {
  const base = asset.name.replace(/\.[^.]+$/, '');
  return `${base || 'audio'}.${AUDIO_EXPORT_EXTENSION}`;
}
