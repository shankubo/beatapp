/**
 * Import d'un reel existant, decoupe en plans editables.
 *
 * Le besoin: reprendre un reel deja monte pour en remplacer une image, en
 * couper un passage ou en changer le son. Importe tel quel, il arrivait en UN
 * seul plan — donc rien n'etait modifiable sans le trancher a la main d'abord.
 *
 * La chaine est entierement automatique:
 *   1. import du fichier (validation par magic bytes, comme tout import);
 *   2. son d'origine pose sur sa propre piste, donc reglable et supprimable;
 *   3. instants de coupe, selon la methode choisie;
 *   4. decoupage en plans, chacun remplacable independamment.
 *
 * Ce qui NE marche pas, et qui doit etre dit: un lien Instagram ou TikTok. Ces
 * sites interdisent le telechargement depuis un navigateur — l'utilisateur doit
 * d'abord enregistrer la video dans sa pellicule. La regle est deja appliquee
 * par `importUrl`.
 */

import { useCallback, useState } from 'react';

import { ImportError, importFile } from './importMedia';
import { detectScenes } from './sceneDetect';
import { analyzeAudio } from '../../audio/beatClient';
import { decodeAudioBlob } from '../../export/audioMix';
import { cutCount, cutIntoClips, frameForSource } from '../../domain/reelCut';
import { createClipForAsset } from '../../domain/project';
import { divisionGrid } from '../../domain/beatmap';
import { ripple } from '../../domain/timeline';
import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import { useMedia } from '../preview/MediaProvider';
import { useLibrary } from './useLibrary';
import { newId } from '../../lib/id';
import type { BeatMap, MediaAsset } from '../../domain/types';

/** Comment decouper le reel importe. */
export type ReelCutMethod = 'beat' | 'scene';

/** Etape en cours, pour informer pendant une attente de plusieurs secondes. */
export type ReelImportStage = 'importing' | 'analyzing' | 'cutting' | null;

export function useImportReel(): {
  importReel: (file: File, method: ReelCutMethod) => Promise<void>;
  stage: ReelImportStage;
} {
  const { register, audioContext } = useMedia();
  const library = useLibrary();
  const pushToast = useUiStore((state) => state.pushToast);
  const [stage, setStage] = useState<ReelImportStage>(null);

  const importReel = useCallback(
    async (file: File, method: ReelCutMethod) => {
      setStage('importing');
      try {
        const { asset, blob } = await importFile(file, { accept: ['video'] });
        await register(asset, blob);
        await library.add(asset);

        setStage('analyzing');
        const { cuts, beatMap } = await findCuts(asset, blob, method, audioContext);

        setStage('cutting');
        applyCutsToProject(asset, cuts);

        /*
          Le son du reel devient la MUSIQUE du projet, pas un « son d'origine ».

          Defaut corrige: pose en role `original`, il etait invisible pour
          l'onglet Beat — `musicTrack()` ne cherche que `role === 'music'`, donc
          l'analyse rythmique n'avait rien a analyser et le menu restait inerte.

          Le role `music` lui donne exactement les memes possibilites qu'un
          fichier audio importe seul: analyse du rythme, decoupage, recalage,
          fondus, volume. C'est ce qu'on attend du son d'un reel qu'on reprend —
          il porte le tempo de tout le montage, ce qui est la definition meme de
          la piste musicale ici.

          Ancre a zero et NON decoupe avec l'image: il couvre tout le reel, et
          le trancher obligerait a recoller des morceaux jointifs pour
          l'entendre sans trou.
        */
        if (asset.hasAudio === true) {
          const store = useProjectStore.getState();
          store.setMusic(asset);

          /*
            L'analyse est REPOSEE apres `setMusic`, et l'ordre est le piege.

            `setMusic` efface `beatMap` — a raison dans le cas general, l'analyse
            portant sur l'ancienne musique. Mais ici elle porte precisement sur
            la piste qu'on vient de poser: l'ecrire avant la ferait disparaitre,
            et l'onglet Beat redemanderait une analyse deja faite.
          */
          if (beatMap) store.setBeatMap(beatMap);
        }
      } catch (error) {
        pushToast({
          i18nKey: error instanceof ImportError ? error.i18nKey : 'errors:import.decodeFailed',
          params: error instanceof ImportError ? error.params : {},
          tone: 'error',
        });
      } finally {
        setStage(null);
      }
    },
    [register, library, audioContext, pushToast],
  );

  return { importReel, stage };
}

/**
 * Instants de coupe, selon la methode demandee.
 *
 * Les deux voies retombent sur un tableau vide en cas d'echec, jamais sur une
 * exception: un reel qui refuserait de s'importer parce que l'analyse a echoue
 * serait un mauvais echange. Sans instant, il arrive en un seul plan — ce que
 * l'utilisateur peut toujours decouper a la main.
 */
async function findCuts(
  asset: MediaAsset,
  blob: Blob,
  method: ReelCutMethod,
  audioContext: BaseAudioContext,
): Promise<{ cuts: number[]; beatMap?: BeatMap }> {
  const duration = asset.duration ?? 0;
  if (!(duration > 0)) return { cuts: [] };

  if (method === 'scene') return { cuts: await detectScenes(blob, duration) };

  // Methode rythmique: le son du reel porte le tempo, donc on l'analyse.
  if (asset.hasAudio !== true) return { cuts: [] };
  try {
    const buffer = await decodeAudioBlob(blob, audioContext);
    const beatMap = await analyzeAudio(asset.id, buffer, { useCache: false });

    /*
      L'analyse est RENVOYEE et non ecrite dans le store: `setMusic`, appele
      ensuite, efface `beatMap`. L'ecrire ici la ferait disparaitre juste apres,
      et l'onglet Beat redemanderait une analyse deja faite.

      `divisionGrid` et non `timelineGrid`: les instants attendus sont en temps
      SOURCE, la piste audio n'existant pas encore au moment du decoupage.
      Passer par la grille timeline demanderait une piste pour calculer un
      decalage qui vaut zero ici.
    */
    return { cuts: divisionGrid(beatMap, 1), beatMap };
  } catch {
    return { cuts: [] };
  }
}

/** Remplace la piste video par le reel decoupe, et aligne le format du projet. */
function applyCutsToProject(asset: MediaAsset, cuts: readonly number[]): void {
  const store = useProjectStore.getState();
  const project = store.project;
  const duration = asset.duration ?? 0;
  const frame = frameForSource(project.frame, asset);

  const options = { duration, cuts, speed: 1 };
  // Les identifiants sont generes ICI: le domaine n'en fabrique pas.
  const ids = Array.from({ length: cutCount(options) }, () => newId('clip'));

  const template = createClipForAsset(asset);
  const clips = cutIntoClips(
    {
      assetId: template.assetId,
      fit: template.fit,
      transform: template.transform,
      // Le son du clip est coupe: il est deja sur sa propre piste, et le
      // laisser actif le ferait entendre deux fois.
      muted: true,
    },
    ids,
    options,
  );

  store.replaceProject({
    ...project,
    frame,
    assets: { ...project.assets, [asset.id]: asset },
    videoTrack: {
      ...project.videoTrack,
      // Le reel REMPLACE le montage courant plutot que de s'y ajouter: on
      // importe un reel pour le reprendre, pas pour l'accoler a autre chose.
      clips: ripple(clips, project.frame.fps),
    },
  });
}
