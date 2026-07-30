/**
 * Commandes de tete, en SURIMPRESSION sur l'apercu: menu, nom du projet, export.
 *
 * Remplace la barre du haut. Elle occupait 44 px de hauteur en permanence, et
 * l'apercu 9:16 etant contraint par la HAUTEUR, c'etait l'axe le plus cher.
 * Plus aucune rangee fixe: l'image occupe tout l'ecran, et les commandes
 * flottent dessus comme sur Instagram.
 *
 * Chaque element porte son propre voile sombre + flou, jamais une transparence
 * nue: sur une image claire, du texte ink-50 sans fond passe sous le seuil de
 * contraste de 4,5:1 que le projet s'impose. C'est le voile local qui rend le
 * « transparent » compatible avec la lisibilite — et il est mesure plus bas
 * dans les tests.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import { MenuIcon } from '../../components/ui/icons';
import { videoDuration } from '../../domain/timeline';

export function FloatingBar() {
  const { t } = useTranslation(['editor', 'export', 'menu']);

  const project = useProjectStore((state) => state.project);
  const renameProject = useProjectStore((state) => state.renameProject);
  const setExportOpen = useUiStore((state) => state.setExportOpen);
  const setMenuOpen = useUiStore((state) => state.setMenuOpen);

  const [editingName, setEditingName] = useState(false);

  const canExport = videoDuration(project.videoTrack) > 0;

  return (
    /*
      `pointer-events-none` sur la rangee, retabli sur chaque commande: la barre
      couvre toute la largeur pour poser ses elements, et sans cela elle
      intercepterait les gestes de pincement sur le haut de l'apercu.
    */
    <div className="safe-pt pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-2 p-2">
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label={t('menu:open')}
        className="pointer-events-auto flex size-11 shrink-0 items-center justify-center rounded-full border border-ink-100/10 bg-ink-950/55 text-ink-50 backdrop-blur-md active:bg-ink-950/75 [&>svg]:size-5"
      >
        <MenuIcon />
      </button>

      {editingName ? (
        <input
          autoFocus
          value={project.name}
          onChange={(event) => renameProject(event.target.value)}
          onBlur={() => setEditingName(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') setEditingName(false);
          }}
          aria-label={t('editor:project.rename')}
          placeholder={t('editor:project.namePlaceholder')}
          className="pointer-events-auto min-w-0 flex-1 rounded-full border border-ink-100/10 bg-ink-950/80 px-3 py-2 text-sm text-ink-50 outline-none backdrop-blur-md"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditingName(true)}
          aria-label={t('editor:project.rename')}
          className="pointer-events-auto min-w-0 flex-1 truncate rounded-full bg-ink-950/40 px-3 py-1.5 text-left text-sm font-semibold text-ink-50 backdrop-blur-sm"
        >
          {/* Nom saisi par l'utilisateur: rendu comme du texte, jamais interprete. */}
          {project.name}
        </button>
      )}

      <button
        type="button"
        onClick={() => setExportOpen(true)}
        disabled={!canExport}
        className="pointer-events-auto min-h-9 shrink-0 rounded-full bg-beat-400/90 px-3.5 text-xs font-bold text-ink-950 backdrop-blur-md active:bg-beat-500 disabled:opacity-60"
      >
        {t('export:cta')}
      </button>
    </div>
  );
}
