/**
 * Extension du fichier envoye a l'API de transcription.
 *
 * Ce test existe a cause d'un bug reel: le code passait un nom de fichier SANS
 * extension, et l'API repondait 400 « file must be one of the following types ».
 * Elle valide le format sur l'extension, pas sur le contenu — un detail
 * invisible a la lecture, d'ou ces cas.
 */

import { describe, expect, it } from 'vitest';

import { audioExtension } from '@/features/text/aiLyrics';

describe('audioExtension', () => {
  it('traduit les types audio courants', () => {
    expect(audioExtension('audio/mpeg')).toBe('mp3');
    expect(audioExtension('audio/mp4')).toBe('m4a');
    expect(audioExtension('audio/wav')).toBe('wav');
    expect(audioExtension('audio/ogg')).toBe('ogg');
    expect(audioExtension('audio/flac')).toBe('flac');
    expect(audioExtension('audio/webm')).toBe('webm');
  });

  it('ignore les parametres du type MIME', () => {
    // `audio/ogg; codecs=opus` est une forme reelle: sans ce nettoyage, la
    // recherche echouerait et on retomberait sur le defaut.
    expect(audioExtension('audio/ogg; codecs=opus')).toBe('ogg');
    expect(audioExtension('audio/mpeg;charset=binary')).toBe('mp3');
  });

  it('tolere la casse', () => {
    expect(audioExtension('AUDIO/MPEG')).toBe('mp3');
  });

  it('retombe sur mp3 pour un type inconnu', () => {
    // Un type inconnu a plus de chances d'etre un MP3 mal etiquete que de
    // reussir avec une extension inventee.
    expect(audioExtension('audio/weird')).toBe('mp3');
    expect(audioExtension('')).toBe('mp3');
  });

  it('produit toujours une extension acceptee par l API', () => {
    // La liste vient du message d'erreur de l'API elle-meme.
    const accepted = ['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'opus', 'wav', 'webm'];
    const types = [
      'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
      'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/opus',
      'audio/flac', 'audio/x-flac', 'audio/webm', 'inconnu', '',
    ];
    for (const type of types) {
      expect(accepted).toContain(audioExtension(type));
    }
  });
});
