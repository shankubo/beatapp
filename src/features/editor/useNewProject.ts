/**
 * Demarrage d'un nouveau reel.
 *
 * L'ordre des operations importe. Le projet vierge est installe EN PREMIER, de
 * sorte que le ramasse-miettes voie deja la nouvelle liste de medias references
 * (vide) quand il s'execute — sinon il conserverait les blobs de l'ancien
 * projet, et « Nouveau » ne libererait aucune place.
 *
 * L'echec du nettoyage n'est pas remonte comme une erreur: du point de vue de
 * l'utilisateur, le nouveau reel est bien ouvert. Des blobs orphelins seront
 * repris au prochain demarrage, qui appelle deja `collectGarbage`.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectStore } from '../../store/useProjectStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { useUiStore } from '../../store/useUiStore';
import { useMedia } from '../preview/MediaProvider';
import { collectGarbage } from '../../storage/mediaStore';
import {
  deleteProject,
  rememberLastProject,
  referencedMediaKeys,
} from '../../storage/projectStore';

export function useNewProject(): { startNewProject: () => Promise<void> } {
  const { t } = useTranslation('editor');

  const project = useProjectStore((state) => state.project);
  const newProject = useProjectStore((state) => state.newProject);
  const resetPlayback = usePlaybackStore((state) => state.reset);
  const closeSheet = useUiStore((state) => state.closeSheet);
  const setOnboardingOpen = useUiStore((state) => state.setOnboardingOpen);
  const { reset: resetMedia } = useMedia();

  const startNewProject = useCallback(async () => {
    const previousId = project.id;

    // 1. Le projet vierge devient l'etat courant.
    newProject(t('project.untitled'));

    // 2. On libere les bitmaps et buffers de l'ancien projet, et on remet la
    //    tete de lecture a zero: elle pointe sur une timeline qui n'existe plus.
    resetMedia();
    resetPlayback();
    closeSheet();
    // Un nouveau reel repart du parcours en 3 etapes: c'est le moment ou le
    // guide est le plus utile.
    setOnboardingOpen(true);

    // 3. L'historique d'annulation decrit l'ancien projet: le conserver
    //    permettrait de « annuler » vers un montage dont les medias viennent
    //    d'etre supprimes.
    useProjectStore.temporal.getState().clear();

    // 4. Le nouveau projet devient celui qu'on rouvrira au prochain demarrage.
    //    Sans cela, un rechargement de l'onglet restaurerait l'ancien projet,
    //    que l'etape suivante vient justement de supprimer.
    rememberLastProject(useProjectStore.getState().project.id);

    // 5. L'ancien enregistrement puis les blobs devenus orphelins.
    try {
      await deleteProject(previousId);
      const keys = await referencedMediaKeys();
      await collectGarbage(keys);
    } catch {
      // Voir l'en-tete: sans consequence pour l'utilisateur.
    }
  }, [project.id, newProject, resetMedia, resetPlayback, closeSheet, setOnboardingOpen, t]);

  return { startNewProject };
}
