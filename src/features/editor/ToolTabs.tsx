import { useTranslation } from 'react-i18next';

import { useUiStore, type ToolTab } from '../../store/useUiStore';
import {
  BeatIcon,
  MusicIcon,
  PhotoIcon,
  SparkIcon,
  SwapIcon,
  TextIcon,
} from '../../components/ui/icons';
import { useProjectStore } from '../../store/useProjectStore';

const TABS: readonly { id: ToolTab; icon: () => React.ReactElement }[] = [
  { id: 'media', icon: PhotoIcon },
  { id: 'edit', icon: SwapIcon },
  { id: 'audio', icon: MusicIcon },
  { id: 'text', icon: TextIcon },
  { id: 'effects', icon: SparkIcon },
  { id: 'beat', icon: BeatIcon },
];

export function ToolTabs() {
  const { t } = useTranslation('editor');
  const activeTab = useUiStore((state) => state.activeTab);
  const openTab = useUiStore((state) => state.openTab);
  const hasBeatMap = useProjectStore((state) => state.project.beatMap !== undefined);

  return (
    <nav
      className="safe-pb flex h-tabs shrink-0 items-stretch border-t border-ink-700 bg-ink-900"
      aria-label={t('timeline.label')}
    >
      {TABS.map(({ id, icon: Icon }) => {
        const active = activeTab === id;
        // L'onglet Beat porte un point chartreuse quand une analyse existe:
        // l'utilisateur sait ainsi que l'aimantation est disponible.
        const showBeatDot = id === 'beat' && hasBeatMap;

        return (
          <button
            key={id}
            type="button"
            onClick={() => openTab(id)}
            aria-pressed={active}
            className={[
              // `min-w-0` + `truncate` sur le libelle: a six onglets sur 390 px,
              // chaque onglet fait ~65 px et un mot long deborderait.
              'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-medium transition-colors',
              active ? 'text-beat-400' : 'text-ink-400 active:text-ink-200',
            ].join(' ')}
          >
            {/*
              L'onglet actif porte une pastille pleine derriere son icone. Une
              simple couleur de texte ne suffisait pas a le distinguer d'un coup
              d'oeil sur un fond sombre.
            */}
            <span
              className={[
                'flex size-8 items-center justify-center rounded-lg transition-colors [&>svg]:size-5',
                active ? 'bg-beat-400/15' : '',
              ].join(' ')}
            >
              <Icon />
            </span>
            <span className="max-w-full truncate">{t(`tabs.${id}`)}</span>

            {/* Trait superieur: repere le plus lisible pour une barre d'onglets. */}
            {active && (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-beat-400"
              />
            )}
            {showBeatDot && !active && (
              <span
                aria-hidden="true"
                className="absolute right-1/2 top-1.5 size-1.5 translate-x-3 rounded-full bg-beat-400"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
