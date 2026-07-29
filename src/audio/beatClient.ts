/**
 * Client type du worker d'analyse rythmique, avec cache IndexedDB.
 */

import type { BeatWorkerRequest, BeatWorkerResponse } from './beatWorker';
import { loadBeatMap, saveBeatMap } from '../storage/projectStore';
import { toMono } from '../export/audioMix';
import type { BeatMap } from '../domain/types';

export class BeatAnalysisError extends Error {
  constructor(readonly i18nKey: string) {
    super(i18nKey);
    this.name = 'BeatAnalysisError';
  }
}

let worker: Worker | null = null;
let nextRequestId = 1;

function getWorker(): Worker {
  worker ??= new Worker(new URL('./beatWorker.ts', import.meta.url), { type: 'module' });
  return worker;
}

/** Libere le worker (appele quand l'editeur se ferme). */
export function disposeBeatWorker(): void {
  worker?.terminate();
  worker = null;
}

/**
 * Analyse un buffer audio. Le resultat est mis en cache par media: l'analyse
 * coute plusieurs secondes, son resultat quelques kilo-octets.
 */
export async function analyzeAudio(
  assetId: string,
  buffer: AudioBuffer,
  options: { useCache?: boolean } = {},
): Promise<BeatMap> {
  if (options.useCache !== false) {
    const cached = await loadBeatMap(assetId);
    if (cached) return cached;
  }

  const samples = toMono(buffer);
  const beatMap = await runAnalysis(assetId, samples, buffer.sampleRate);

  void saveBeatMap(beatMap);
  return beatMap;
}

function runAnalysis(
  assetId: string,
  samples: Float32Array,
  sampleRate: number,
): Promise<BeatMap> {
  return new Promise((resolve, reject) => {
    const activeWorker = getWorker();
    const requestId = nextRequestId++;

    const handleMessage = (event: MessageEvent<BeatWorkerResponse>) => {
      const data = event.data;
      // Plusieurs analyses peuvent etre en vol: on ne traite que la notre.
      if (data.requestId !== requestId) return;

      activeWorker.removeEventListener('message', handleMessage);
      activeWorker.removeEventListener('error', handleError);

      if (data.ok) resolve(data.beatMap);
      else reject(new BeatAnalysisError(data.i18nKey));
    };

    const handleError = () => {
      activeWorker.removeEventListener('message', handleMessage);
      activeWorker.removeEventListener('error', handleError);
      reject(new BeatAnalysisError('audio.analysisFailed'));
    };

    activeWorker.addEventListener('message', handleMessage);
    activeWorker.addEventListener('error', handleError);

    const request: BeatWorkerRequest = { requestId, assetId, samples, sampleRate };
    // On TRANSFERE le buffer: sans cela, un morceau de 3 minutes serait copie
    // (environ 30 Mo), ce qui doublerait l'empreinte memoire le temps de l'envoi.
    activeWorker.postMessage(request, [samples.buffer]);
  });
}
