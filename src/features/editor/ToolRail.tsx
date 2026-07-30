/**
 * Rail d'outils vertical, pose sur le bord droit de l'apercu.
 *
 * Remplace la barre d'onglets du bas. Deux raisons mesurees:
 *
 *  - la barre du bas prenait 56 px de HAUTEUR sur toute la largeur, alors que
 *    l'apercu 9:16 est contraint par la hauteur — c'etait le pire axe a payer.
 *    Le rail est en surimpression: il ne coute rien a la mise en page;
 *  - a droite, sous le pouce d'une main qui tient le telephone. C'est aussi ou
 *    Instagram et CapCut posent leurs outils, donc le geste est deja acquis.
 *
 * Icones seules: le rail fait 52 px et laisse l'image respirer. Le libelle
 * apparait a l'appui — il faut qu'un nom soit atteignable, sans quoi une icone
 * mal comprise devient un cul-de-sac.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUiStore, type ToolTab } from '../../store/useUiStore';
import { useProjectStore } from '../../store/useProjectStore';
import {
  BeatIcon,
  MusicIcon,
  PhotoIcon,
  SparkIcon,
  SwapIcon,
  TextIcon,
} from '../../components/ui/icons';

/**
 * Ordre des outils: il suit le PARCOURS de montage.
 *
 * Media, Audio, Beat reprennent les trois etapes de l'ecran de demarrage —
 * importer, sonoriser, caler. Modifier, Texte, Effets viennent ensuite: ce sont
 * les retouches, qui n'ont de sens qu'une fois le montage en place.
 */
const TOOLS: readonly { id: ToolTab; icon: () => React.ReactElement }[] = [
  { id: 'media', icon: PhotoIcon },
  { id: 'audio', icon: MusicIcon },
  { id: 'beat', icon: BeatIcon },
  { id: 'edit', icon: SwapIcon },
  { id: 'text', icon: TextIcon },
  { id: 'effects', icon: SparkIcon },
];

/** Duree d'affichage du libelle apres un appui, en millisecondes. */
const LABEL_MS = 1400;

export function ToolRail() {
  const { t } = useTranslation('editor');
  const activeTab = useUiStore((state) => state.activeTab);
  const openTab = useUiStore((state) => state.openTab);
  const hasBeatMap = useProjectStore((state) => state.project.beatMap !== undefined);

  /* Libelle transitoire du dernier outil touche. */
  const [shown, setShown] = useState<ToolTab | null>(null);
  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => setShown(null), LABEL_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);

  return (
    <nav
      aria-label={t('timeline.label')}
      /*
        `pointer-events-none` sur le conteneur, retabli sur chaque bouton: la
        colonne s'etend sur toute la hauteur pour centrer le rail, et sans cela
        elle intercepterait les gestes de pincement sur l'apercu.
      */
      className="pointer-events-none absolute inset-y-0 right-0 z-30 flex items-center pr-1.5"
    >
      <ul className="pointer-events-auto flex flex-col gap-0.5 rounded-2xl border border-ink-700/40 bg-ink-950/55 p-1 backdrop-blur-md">
        {TOOLS.map(({ id, icon: Icon }) => {
          const active = activeTab === id;
          // L'outil Beat porte un point chartreuse quand une analyse existe:
          // l'utilisateur sait ainsi que l'aimantation est disponible.
          const showBeatDot = id === 'beat' && hasBeatMap;

          return (
            <li key={id} className="relative">
              <button
                type="button"
                onClick={() => {
                  setShown(id);
                  openTab(id);
                }}
                aria-pressed={active}
                aria-label={t(`tabs.${id}`)}
                className={[
                  'relative flex size-11 items-center justify-center rounded-xl transition-colors [&>svg]:size-5',
                  active ? 'bg-beat-400/20 text-beat-400' : 'text-ink-200 active:bg-ink-800/70',
                ].join(' ')}
              >
                <Icon />
                {showBeatDot && !active && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-beat-400"
                  />
                )}
              </button>

              {/*
                Libelle transitoire, pose A GAUCHE du rail: a droite il sortirait
                de l'ecran, le rail etant deja colle au bord.
              */}
              {shown === id && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute right-full top-1/2 mr-1 -translate-y-1/2 whitespace-nowrap rounded-lg bg-ink-950/90 px-2 py-1 text-[11px] font-medium text-ink-100 backdrop-blur-sm"
                >
                  {t(`tabs.${id}`)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
