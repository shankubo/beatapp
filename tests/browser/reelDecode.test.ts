/**
 * Sonde: pourquoi le son d'un reel importe reste-t-il muet ?
 *
 * Le modele de donnees est correct (`reelAudio.test.ts` le verrouille). Le
 * defaut est donc dans l'ENCHAINEMENT a l'execution. Ce test reproduit la
 * sequence reelle de `useImportReel` sur un vrai fichier, et verifie que le
 * buffer audio existe bien au moment ou la lecture en aurait besoin.
 */

import { describe, expect, it } from 'vitest';

import { decodeAudioBlob } from '@/export/audioMix';
import { encodeWav } from '@/features/samples/sampleGen';

/** Fabrique un WAV de `seconds` secondes, non silencieux. */
function makeWav(context: AudioContext, seconds: number): Blob {
  const rate = 44_100;
  const buffer = context.createBuffer(1, Math.floor(rate * seconds), rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.sin((2 * Math.PI * 220 * i) / rate) * 0.5;
  }
  return encodeWav(buffer);
}

describe('decodage audio en chaine', () => {
  it('decode deux fois le MEME blob sans echouer', async () => {
    /*
      Le piege suspecte: `useImportReel` lit le blob DEUX fois — une fois via
      `register` (qui decode pour la lecture) et une fois via `findCuts` (qui
      decode pour l'analyse). `decodeAudioData` consomme l'ArrayBuffer qu'on lui
      passe; si les deux appels partageaient le meme tableau, le second
      echouerait et le son disparaitrait.

      `decodeAudioBlob` reprend `blob.arrayBuffer()` a chaque appel, donc chacun
      recoit une copie fraiche. Ce test le verrouille.
    */
    const context = new AudioContext();
    const blob = makeWav(context, 2);

    const first = await decodeAudioBlob(blob, context);
    const second = await decodeAudioBlob(blob, context);

    expect(first.duration).toBeGreaterThan(1.9);
    expect(second.duration).toBeCloseTo(first.duration, 3);

    // Le signal n'est pas silencieux: un buffer vide se lirait comme « pas de
    // son » sans qu'aucune erreur ne soit levee.
    let peak = 0;
    const data = second.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]!));
    expect(peak).toBeGreaterThan(0.1);

    await context.close();
  });

  it('decode encore apres un premier decodage concurrent', async () => {
    // `register` et `findCuts` peuvent se chevaucher: on verifie que deux
    // decodages simultanes du meme blob aboutissent tous les deux.
    const context = new AudioContext();
    const blob = makeWav(context, 1);

    const [a, b] = await Promise.all([
      decodeAudioBlob(blob, context),
      decodeAudioBlob(blob, context),
    ]);

    expect(a.duration).toBeGreaterThan(0.9);
    expect(b.duration).toBeGreaterThan(0.9);

    await context.close();
  });
});
