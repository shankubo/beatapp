/**
 * Racine de l'application.
 *
 * Responsabilites: charger ou creer le projet, brancher l'autosave, et fournir
 * le contexte media. L'edition elle-meme vit dans `EditorShell`.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EditorShell } from './features/editor/EditorShell';
import { MediaProvider } from './features/preview/MediaProvider';
import { useProjectStore } from './store/useProjectStore';
import { useUiStore } from './store/useUiStore';
import { usePreferencesStore } from './store/usePreferencesStore';
import { isProjectEmpty } from './features/onboarding/onboardingState';
import { createEmptyProject } from './domain/project';
import {
  ProjectAutosaver,
  lastProjectId,
  loadProject,
  rememberLastProject,
  referencedMediaKeys,
} from './storage/projectStore';
import { collectGarbage } from './storage/mediaStore';
import { requestPersistentStorage } from './storage/db';

export function App() {
  const { t } = useTranslation(['editor', 'errors']);

  const project = useProjectStore((state) => state.project);
  const replaceProject = useProjectStore((state) => state.replaceProject);

  const [ready, setReady] = useState(false);
  const autosaver = useRef<ProjectAutosaver | null>(null);
  /** L'ecran de demarrage n'est propose qu'une fois par session. */
  const didDecide = useRef(false);

  // --- Chargement initial.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Demande la persistance: sans elle, le navigateur peut evincer les
      // projets sous pression disque.
      void requestPersistentStorage();

      const previousId = lastProjectId();
      if (previousId) {
        try {
          const existing = await loadProject(previousId);
          if (existing && !cancelled) {
            replaceProject(existing);
            setReady(true);
            return;
          }
        } catch {
          // Projet illisible: on repart d'un projet neuf plutot que de bloquer.
        }
      }

      if (cancelled) return;
      // Le nom par defaut est traduit ici: le domaine ne connait pas i18next.
      // Le format et le fond viennent des preferences: un premier lancement
      // apres un « effacer les donnees » doit retrouver les reglages choisis.
      const { frame, background } = usePreferencesStore.getState().importPreferences;
      const fresh = createEmptyProject(t('editor:project.untitled'), { frame, background });
      replaceProject(fresh);
      rememberLastProject(fresh.id);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
    // `t` est volontairement exclu: un changement de langue ne doit pas
    // recharger le projet ni renommer celui de l'utilisateur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaceProject]);

  /**
   * Ecran de demarrage: uniquement sur un projet vide.
   *
   * La decision est prise ICI parce que `App` est le seul a savoir quand la
   * restauration est terminee. L'evaluer plus tot montrerait les 3 etapes une
   * fraction de seconde avant de reveler un montage en cours.
   *
   * `didDecide` garantit une decision unique par session: sans lui, supprimer
   * son dernier clip rouvrirait l'ecran en pleine edition.
   */
  useEffect(() => {
    if (!ready || didDecide.current) return;
    didDecide.current = true;

    // On lit l'etat directement plutot que de s'abonner: l'effet ne doit
    // dependre que de `ready`.
    if (isProjectEmpty(useProjectStore.getState().project)) {
      useUiStore.getState().setOnboardingOpen(true);
    }
  }, [ready]);

  // --- Nettoyage des medias orphelins, une fois le projet charge.
  useEffect(() => {
    if (!ready) return;
    void (async () => {
      const keys = await referencedMediaKeys();
      // `null` signifie "liste inconnue": `collectGarbage` s'abstient alors.
      await collectGarbage(keys);
    })();
  }, [ready]);

  // --- Enregistrement automatique.
  useEffect(() => {
    autosaver.current ??= new ProjectAutosaver();
    return () => {
      void autosaver.current?.flush();
      autosaver.current?.dispose();
      autosaver.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    autosaver.current?.schedule(project);
    rememberLastProject(project.id);
  }, [project, ready]);

  // Sur mobile, l'onglet peut etre tue sans preavis apres passage en
  // arriere-plan: on force l'ecriture a ce moment-la.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden') void autosaver.current?.flush();
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, []);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">{t('editor:preview.label')}</p>
      </div>
    );
  }

  return (
    <MediaProvider project={project}>
      <EditorShell />
    </MediaProvider>
  );
}
