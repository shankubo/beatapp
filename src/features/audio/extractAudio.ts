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
 * On exporte donc en **M4A/AAC** quand le navigateur sait l'encoder, et en
 * **WebM/Opus** sinon. Deuxieme mesure, sur le Chromium de l'integration
 * continue: `mp4a.40.2` y est REFUSE — les builds open source de Chromium
 * n'embarquent pas les codecs proprietaires, contrairement au Chrome installe.
 * Figer l'AAC aurait donc casse l'export chez une partie des utilisateurs, en
 * silence. Opus est disponible partout et sert de repli.
 */

import { ImportError } from '../import/importMedia';
import type { MediaAsset } from '../../domain/types';

/** Format retenu pour l'ecriture d'un fichier audio. */
export interface AudioExportFormat {
  codec: 'aac' | 'opus';
  mimeType: string;
  extension: string;
}

const AAC_FORMAT: AudioExportFormat = {
  codec: 'aac',
  mimeType: 'audio/mp4',
  extension: 'm4a',
};

const OPUS_FORMAT: AudioExportFormat = {
  codec: 'opus',
  mimeType: 'audio/webm',
  extension: 'webm',
};

/**
 * Choisit le meilleur format que CE navigateur sait reellement encoder.
 *
 * Sonde a l'execution et non deduit d'une liste de navigateurs: la meme version
 * de Chromium accepte ou refuse l'AAC selon qu'elle a ete compilee avec les
 * codecs proprietaires. Seul `isConfigSupported` dit la verite.
 */
export async function pickAudioExportFormat(): Promise<AudioExportFormat> {
  if (typeof AudioEncoder === 'undefined') return OPUS_FORMAT;
  try {
    const support = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate: 48_000,
      numberOfChannels: 2,
      bitrate: AUDIO_BITRATE,
    });
    return support.supported === true ? AAC_FORMAT : OPUS_FORMAT;
  } catch {
    return OPUS_FORMAT;
  }
}

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

  // L'extraction ecrit toujours du MP4: elle RECOPIE un flux existant, sans
  // encodeur, donc la capacite du navigateur n'entre pas en jeu.
  return new Blob([buffer], { type: AAC_FORMAT.mimeType });
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
export async function encodeAudioBuffer(
  buffer: AudioBuffer,
  format?: AudioExportFormat,
): Promise<Blob> {
  const { AudioBufferSource, Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat } =
    await import('mediabunny');

  const chosen = format ?? (await pickAudioExportFormat());

  const source = new AudioBufferSource({ codec: chosen.codec, bitrate: AUDIO_BITRATE });
  const output = new Output({
    format: chosen.codec === 'aac' ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  output.addAudioTrack(source);

  await output.start();
  // `await` sur `add`: c'est la contre-pression qui borne la memoire, meme
  // regle que l'export video.
  await source.add(buffer);
  source.close();
  await output.finalize();

  const result = output.target.buffer;
  if (!result) throw new ImportError('errors:import.decodeFailed');

  return new Blob([result], { type: chosen.mimeType });
}

/**
 * Nom de fichier propose pour l'audio extrait d'une video.
 *
 * On repart du nom d'origine prive de son extension: retrouver « vacances.m4a »
 * a cote de « vacances.mp4 » est ce qu'on attend, la ou un nom genere serait a
 * renommer a la main.
 */
export function audioNameFor(
  asset: MediaAsset | { name: string },
  extension = AAC_FORMAT.extension,
): string {
  const base = asset.name.replace(/\.[^.]+$/, '');
  return `${base || 'audio'}.${extension}`;
}
