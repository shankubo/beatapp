/**
 * Application d'une boucle generee, partagee par le panneau Audio et l'ecran
 * de demarrage.
 *
 * La boucle est encodee en WAV et stockee comme n'importe quel import: cela
 * evite un chemin de code special dans le reste de l'application (lecture,
 * export et analyse rythmique traitent tous un blob).
 *
 * La fonction LEVE au lieu d'avaler l'erreur: chaque appelant reagit
 * differemment — le panneau Audio se contente d'un message, l'ecran de
 * demarrage doit savoir s'il peut cocher son etape.
 */

import { useCallback } from 'react';

import {
  encodeWav,
  findGeneratedSample,
  renderSample,
  sampleAssetMetadata,
} from './sampleGen';
import { useMedia } from '../preview/MediaProvider';
import { useProjectStore } from '../../store/useProjectStore';
import { putMedia } from '../../storage/mediaStore';
import { newId } from '../../lib/id';
import type { MediaAsset } from '../../domain/types';

export function useGeneratedSample(): {
  /** Rend la boucle, la stocke et la pose comme musique du projet. */
  applyGeneratedSample: (sampleId: string) => Promise<MediaAsset>;
} {
  const setMusic = useProjectStore((state) => state.setMusic);
  const { register, audioContext } = useMedia();

  const applyGeneratedSample = useCallback(
    async (sampleId: string): Promise<MediaAsset> => {
      const sample = findGeneratedSample(sampleId);
      if (!sample) throw new Error(`sample genere inconnu: ${sampleId}`);

      const buffer = renderSample(sample, audioContext, 30);
      const blob = encodeWav(buffer);
      const assetId = newId('asset');
      const storage = await putMedia(`${assetId}.wav`, blob);

      const asset: MediaAsset = {
        ...sampleAssetMetadata(sample, buffer, blob),
        id: assetId,
        storage,
      };

      await register(asset, blob);
      setMusic(asset);
      return asset;
    },
    [audioContext, register, setMusic],
  );

  return { applyGeneratedSample };
}
