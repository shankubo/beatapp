/**
 * Orchestration de l'export depuis l'UI.
 *
 * Le decodage exact des videos (`DecodedMediaCache`) est prepare frame par
 * frame: `MediaCache.frameAt` est synchrone, alors que le decodage est
 * asynchrone. On enveloppe donc le cache pour appeler `prepare(t)` avant chaque
 * `buildScene`, ce qui garantit que la frame demandee est bien disponible.
 */

import { useCallback, useRef, useState } from 'react';

import { DecodedMediaCache } from '../../export/DecodedMediaCache';
import {
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  exportMp4,
  type ExportProgress,
  QUALITY_ULTRA,
  QUALITY_4K,
  type QualityTier,
} from '../../export/webcodecs';
import { ExportError, probeExportCapability, type ExportErrorKey } from '../../export/capability';
import { useMedia } from '../preview/MediaProvider';
import { useProjectStore } from '../../store/useProjectStore';
import { useWakeLock } from '../../hooks/useWakeLock';
import { videoDuration } from '../../domain/timeline';

export type QualityChoice = 'uhd' | 'ultra' | 'high' | 'medium';

/** Palier correspondant a un choix, dans l'ordre du selecteur. */
export const QUALITY_TIERS: Readonly<Record<QualityChoice, QualityTier>> = {
  uhd: QUALITY_4K,
  ultra: QUALITY_ULTRA,
  high: QUALITY_HIGH,
  medium: QUALITY_MEDIUM,
};

export interface ExportState {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: ExportProgress | null;
  /** Resultat pret a partager ou telecharger. */
  result: { blob: Blob; url: string } | null;
  /** Cle i18n de l'erreur (namespace `errors`). */
  errorKey: ExportErrorKey | null;
}

const INITIAL: ExportState = { status: 'idle', progress: null, result: null, errorKey: null };

export function useExport() {
  const { blobs, audioBuffers } = useMedia();
  const { acquire, release } = useWakeLock();

  const [state, setState] = useState<ExportState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setState(INITIAL);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const start = useCallback(
    async (quality: QualityChoice) => {
      const project = useProjectStore.getState().project;

      if (videoDuration(project.videoTrack) <= 0) {
        setState({ ...INITIAL, status: 'error', errorKey: 'errors:export.empty' });
        return;
      }

      const tier = QUALITY_TIERS[quality];
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ status: 'running', progress: null, result: null, errorKey: null });
      await acquire();

      let cache: DecodedMediaCache | null = null;

      try {
        cache = await DecodedMediaCache.create(project, blobs);
        const decoded = cache;

        const { blob } = await exportMp4(project, decoded, audioBuffers, {
          tier,
          signal: controller.signal,
          onProgress: (progress) => setState((s) => ({ ...s, progress })),
          prepareFrame: (time) => decoded.prepare(time),
        });

        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setState({ status: 'done', progress: null, result: { blob, url }, errorKey: null });
      } catch (error) {
        if (controller.signal.aborted) {
          setState(INITIAL);
        } else {
          setState({
            status: 'error',
            progress: null,
            result: null,
            errorKey: error instanceof ExportError ? error.i18nKey : 'errors:export.encodeFailed',
          });
        }
      } finally {
        cache?.dispose();
        release();
        abortRef.current = null;
      }
    },
    [blobs, audioBuffers, acquire, release],
  );

  return { state, start, cancel, reset };
}

/** Etat de la capacite d'export, sonde une seule fois. */
export function useExportCapability() {
  const [capability, setCapability] = useState<'unknown' | 'mp4' | 'webm-only' | 'none'>(
    'unknown',
  );
  /*
    Quelles qualites sont reellement encodables sur cet appareil.

    Defaut optimiste pour `high`/`medium` (le cas de tres loin le plus frequent,
    et la sonde corrige en quelques millisecondes), mais PESSIMISTE pour `ultra`:
    proposer un palier que la plupart des appareils refusent, puis le retirer sous
    le doigt de l'utilisateur, serait pire que de l'afficher un instant plus tard.
  */
  const [supported, setSupported] = useState<Record<QualityChoice, boolean>>({
    uhd: false,
    ultra: false,
    high: true,
    medium: true,
  });

  const probe = useCallback(async () => {
    const result = await probeExportCapability();
    setCapability(result.capability.kind);
    setSupported(result.supported);
  }, []);

  return { capability, supported, probe };
}
