/**
 * Panneau glissant depuis le bas.
 *
 * Choix structurel: ouvrir un panneau REDUIT l'apercu au lieu de le recouvrir
 * (la reduction est faite par la grille de l'ecran parent). L'utilisateur voit
 * donc toujours ce qu'il edite — sur un ecran de telephone, cacher l'apercu
 * pour afficher un reglage de couleur rendrait le reglage inutilisable.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useDrag } from '@use-gesture/react';

import { CloseIcon } from './icons';
import type { SheetSnap } from '../../store/useUiStore';

interface BottomSheetProps {
  open: boolean;
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  onClose: () => void;
  /** Titre deja traduit. */
  title: string;
  /** Libelle du bouton de fermeture, deja traduit. */
  closeLabel: string;
  children: ReactNode;
}

/** Ordre des positions d'accroche, du plus ferme au plus ouvert. */
const SNAP_ORDER: readonly SheetSnap[] = ['closed', 'peek', 'half', 'full'];

export function BottomSheet({
  open,
  snap,
  onSnapChange,
  onClose,
  title,
  closeLabel,
  children,
}: BottomSheetProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Le contenu revient en haut a chaque changement de panneau: sinon on ouvre
  // l'onglet Texte a la position de defilement de l'onglet Audio.
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: 0 });
  }, [open, title]);

  /**
   * Glissement sur la poignee: on change de cran selon la vitesse et la
   * distance. Un geste rapide saute directement au cran suivant, meme si la
   * distance est courte — c'est ce qui donne la sensation "physique".
   */
  const bindHandle = useDrag(
    ({ last, movement: [, my], velocity: [, vy], direction: [, dy] }) => {
      if (!last) return;

      const index = SNAP_ORDER.indexOf(snap);
      const flick = vy > 0.5;
      const far = Math.abs(my) > 60;
      if (!flick && !far) return;

      // dy > 0 = vers le bas = on referme.
      const next = dy > 0 ? index - 1 : index + 1;
      const clamped = Math.max(0, Math.min(SNAP_ORDER.length - 1, next));
      onSnapChange(SNAP_ORDER[clamped]!);
    },
    { axis: 'y', filterTaps: true, pointer: { touch: true } },
  );

  if (!open) return null;

  return (
    <section
      // Coins arrondis et ombre portee: le panneau flotte desormais AU-DESSUS de
      // la timeline, et sans ce relief son bord haut se confondait avec elle.
      className="flex size-full min-h-0 flex-col overflow-hidden rounded-t-2xl border-t border-ink-700 bg-ink-900 shadow-[0_-12px_32px_-8px_rgb(0_0_0/0.55)]"
      aria-label={title}
    >
      {/* Poignee: cible tactile de 44px pour un trait visuel de 4px. */}
      <div
        {...bindHandle()}
        className="flex shrink-0 touch-none items-center justify-between pl-4 pr-1"
      >
        <div className="flex flex-1 items-center gap-3 py-3">
          <span aria-hidden="true" className="h-1 w-9 rounded-full bg-ink-600" />
          <h2 className="text-sm font-semibold tracking-tight text-ink-50">{title}</h2>
        </div>
        {/*
          Croix sur pastille pleine, et non l'icone nue des commandes flottantes.

          Ici le fond est opaque et non une image: le contraste n'est pas en
          jeu, la VISIBILITE l'est. Posee nue en bout de bandeau, la croix se
          confondait avec les icones du rail juste derriere elle. La pastille la
          detache de tout ce qui l'entoure et donne une cible franche.
        */}
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="mr-1 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-200 active:bg-ink-700 [&>svg]:size-4"
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-ink-700 [&>svg]:size-3.5">
            <CloseIcon />
          </span>
        </button>
      </div>

      <div
        ref={scrollRef}
        className="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
      >
        {children}
      </div>
    </section>
  );
}
