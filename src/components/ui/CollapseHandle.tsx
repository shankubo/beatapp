/**
 * Poignee de pliage d'une barre.
 *
 * Toujours visible, pliee comme depliee: une commande qui disparait avec ce
 * qu'elle a masque devient introuvable, et l'utilisateur n'a alors plus aucun
 * moyen de revenir en arriere.
 *
 * 18 px de haut, soit bien moins que la cible tactile de 44 px du projet. C'est
 * assume et compense par la LARGEUR: la poignee occupe toute la largeur de
 * l'ecran, donc la surface reelle depasse largement 44x44. La contraindre a
 * 44 px de haut annulerait une bonne part de ce que le pliage fait gagner.
 */

import { ChevronDownIcon, ChevronUpIcon } from './icons';

export function CollapseHandle({
  collapsed,
  onToggle,
  label,
  /** `top`: la barre est AU-DESSUS de la poignee. `bottom`: en dessous. */
  side,
}: {
  collapsed: boolean;
  onToggle: () => void;
  label: string;
  side: 'top' | 'bottom';
}) {
  /*
    Le chevron pointe vers ce qui VA se passer, pas vers ce qui est masque.

    Pour une barre du haut, la replier la fait remonter: le chevron monte. Pour
    une barre du bas, la replier la fait descendre. Deplie, il pointe dans le
    sens inverse — celui du retour.
  */
  const pointsUp = side === 'top' ? !collapsed : collapsed;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={label}
      className={[
        'flex h-[18px] w-full shrink-0 items-center justify-center bg-ink-900 text-ink-400 active:bg-ink-800 [&>svg]:size-4',
        side === 'top' ? 'border-b border-ink-700' : 'border-t border-ink-700',
      ].join(' ')}
    >
      {pointsUp ? <ChevronUpIcon /> : <ChevronDownIcon />}
    </button>
  );
}
