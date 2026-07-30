/**
 * Commandes de tete, en SURIMPRESSION sur l'apercu: menu, nom du projet, export.
 *
 * Remplace la barre du haut. Elle occupait 44 px de hauteur en permanence, et
 * l'apercu 9:16 etant contraint par la HAUTEUR, c'etait l'axe le plus cher.
 * Plus aucune rangee fixe: l'image occupe tout l'ecran, et les commandes
 * flottent dessus comme sur Instagram.
 *
 * Icones NUES, detourees par une ombre portee et non par une pastille.
 *
 * Les cartouches sombres avaient d'abord ete poses pour garantir le contraste;
 * ils alourdissaient l'apercu au point de le decouper en vignettes. L'ombre
 * (`drop-shadow`) remplit le meme role — elle detoure le glyphe quel que soit le
 * fond, y compris un ciel blanc — sans ajouter de surface opaque.
 *
 * La cible tactile reste a 44 px partout: c'est la zone TOUCHABLE, invisible,
 * et la reduire avec l'icone rendrait les commandes penibles a viser au pouce.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import { MenuIcon, ShareIcon } from '../../components/ui/icons';
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
        // Icone nue: la cible reste a 44 px, seule la pastille disparait. C'est
        // l'ombre portee qui garantit le contraste sur une image claire.
        className="pointer-events-auto flex size-11 shrink-0 items-center justify-center text-ink-50 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] transition-opacity active:opacity-70 [&>svg]:size-6"
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
          className="pointer-events-auto min-w-0 flex-1 truncate px-1 text-left text-sm font-semibold text-ink-50 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
        >
          {/* Nom saisi par l'utilisateur: rendu comme du texte, jamais interprete. */}
          {project.name}
        </button>
      )}

      {/*
        Export en ICONE de partage, comme les autres commandes flottantes.

        Il garde `beat-400` — c'est l'action terminale du parcours, et la seule
        de cette rangee a etre teintee. Le libelle reste porte par `aria-label`
        et par l'entree « Exporter le reel » du menu: une icone seule ne dit pas
        ce qu'elle fait a qui la decouvre.
      */}
      <button
        type="button"
        onClick={() => setExportOpen(true)}
        disabled={!canExport}
        aria-label={t('export:cta')}
        className="pointer-events-auto flex size-11 shrink-0 items-center justify-center text-beat-400 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] transition-opacity active:opacity-70 disabled:opacity-40 [&>svg]:size-6"
      >
        <ShareIcon />
      </button>
    </div>
  );
}
