/**
 * Application d'un modele au projet courant.
 *
 * Seule piece de la fonctionnalite qui touche aux stores — la recette elle-meme
 * est une fonction pure du domaine. Meme repartition que `useGeneratedSample`:
 * le calcul d'un cote, les effets de l'autre.
 */

import { useCallback, useState } from 'react';

import { applyTemplate } from '../../domain/template';
import { musicTrack } from '../../domain/project';
import { timelineGrid } from '../../domain/snapping';
import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import { useMedia } from '../preview/MediaProvider';
import { useGeneratedSample } from './useGeneratedSample';
import type { Template } from '../../domain/template';

export function useApplyTemplate(): {
  apply: (template: Template) => Promise<void>;
  busy: boolean;
} {
  const { audioContext } = useMedia();
  const { applyGeneratedSample } = useGeneratedSample();
  const pushToast = useUiStore((state) => state.pushToast);
  const closeSheet = useUiStore((state) => state.closeSheet);
  const setOnboardingOpen = useUiStore((state) => state.setOnboardingOpen);
  const [busy, setBusy] = useState(false);

  const apply = useCallback(
    async (template: Template) => {
      setBusy(true);
      try {
        /*
          `resume()` en PREMIER: l'`AudioContext` est cree hors geste
          utilisateur, donc suspendu. Tout gestionnaire de clic qui menera a du
          son doit le reveiller, sinon la boucle serait posee sans jamais
          s'entendre.
        */
        void audioContext.resume();

        const before = useProjectStore.getState().project;
        const wasEmpty = before.videoTrack.clips.length === 0;

        /*
          Musique assortie, UNIQUEMENT si le projet n'en a pas.

          Ecraser une musique choisie serait destructeur — et `setMusic` efface
          `beatMap` au passage, donc une analyse rythmique deja faite serait
          perdue par un simple appui sur un modele.
        */
        if (template.suggestedSampleId && !musicTrack(before)) {
          await applyGeneratedSample(template.suggestedSampleId);
        }

        /*
          L'etat est RELU apres l'await: `applyGeneratedSample` a pu remplacer la
          piste musicale, et travailler sur la copie capturee avant l'attente
          ecraserait ce qu'il vient de poser.
        */
        const store = useProjectStore.getState();
        const project = store.project;

        /*
          Grille resolue ici, pas dans le domaine: `timelineGrid` a besoin de la
          piste musicale et de la division, ce qui ferait entrer le store dans
          une fonction qui doit rester pure.

          Elle est vide juste apres la pose d'une musique — `setMusic` ayant
          efface `beatMap`. La cadence retombe alors sur des durees uniformes,
          ce qui est correct: l'analyse rythmique reste a la main de
          l'utilisateur, comme partout ailleurs dans l'application.
        */
        const grid = project.beatMap
          ? timelineGrid(project.beatMap, musicTrack(project), template.division)
          : [];

        store.replaceProject(
          applyTemplate(project, template, { grid, fps: project.frame.fps }),
        );

        closeSheet();

        // Projet vide: l'utilisateur enchaine naturellement sur l'import.
        if (wasEmpty) {
          setOnboardingOpen(true);
          return;
        }

        pushToast({
          i18nKey: 'samples:templates.applied',
          tone: 'info',
          // L'annulation est gratuite: le store est deja sous zundo.
          undo: () => useProjectStore.temporal.getState().undo(),
        });
      } catch {
        pushToast({ i18nKey: 'errors:audio.decodeFailed', tone: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [audioContext, applyGeneratedSample, closeSheet, pushToast, setOnboardingOpen],
  );

  return { apply, busy };
}
