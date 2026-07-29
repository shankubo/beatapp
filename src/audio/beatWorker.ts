/**
 * Worker d'analyse rythmique.
 *
 * L'analyse d'un morceau de 3 minutes represente environ 15 000 FFT: sur le
 * thread principal, l'interface serait gelee plusieurs secondes. Ici elle tourne
 * a cote, et l'UI reste reactive.
 */

import { analyzeBeats } from './beatDetection';
import type { BeatMap } from '../domain/types';

export interface BeatWorkerRequest {
  requestId: number;
  assetId: string;
  /** Signal mono. Transfere (et non copie) pour eviter un doublon en memoire. */
  samples: Float32Array;
  sampleRate: number;
}

export type BeatWorkerResponse =
  | { requestId: number; ok: true; beatMap: BeatMap }
  | { requestId: number; ok: false; i18nKey: string };

self.onmessage = (event: MessageEvent<BeatWorkerRequest>) => {
  const { requestId, assetId, samples, sampleRate } = event.data;

  try {
    const beatMap = analyzeBeats(samples, sampleRate, assetId);
    const response: BeatWorkerResponse = { requestId, ok: true, beatMap };
    self.postMessage(response);
  } catch {
    const response: BeatWorkerResponse = {
      requestId,
      ok: false,
      i18nKey: 'audio.analysisFailed',
    };
    self.postMessage(response);
  }
};
