/**
 * Une carte de l'ecran de demarrage.
 *
 * Purement presentationnelle: toutes les chaines arrivent deja traduites, comme
 * pour `BottomSheet` et `ConfirmDialog`. Les trois cartes partagent ce
 * composant, ce qui garantit qu'elles se comportent identiquement; seules leurs
 * actions different, et elles sont fournies par l'appelant.
 */

import { CheckIcon } from '../../components/ui/icons';
import type { StepState } from './onboardingState';

/**
 * Famille de couleur de la carte, qui dit CE QU'ELLE MANIPULE.
 *
 * Chaque etape porte l'accent de son domaine — bleu pour l'image, violet pour le
 * son, chartreuse pour le rythme. Trois cartes identiques diraient « trois choix
 * equivalents »; ici la couleur annonce le contenu avant meme la lecture, et
 * l'accent se retrouve ensuite dans le panneau correspondant.
 */
export type StepTone = 'media' | 'audio' | 'beat';

interface StepCardProps {
  /** Numeral affiche, deja localise. */
  number: string;
  /** Libelle de l'etape, deja traduit. */
  label: string;
  /** Ligne d'etat sous le numeral (nombre de clips, BPM…), deja traduite. */
  detail: string;
  state: StepState;
  tone: StepTone;
  onClick: () => void;
}

/** Classes par famille. Enumerees en entier: Tailwind ne lit pas les chaines construites. */
const TONE = {
  media: {
    border: 'border-media-400/45',
    numeral: 'text-media-400/60',
    label: 'text-media-400',
    glow: 'from-media-400/10',
  },
  audio: {
    border: 'border-audio-400/45',
    numeral: 'text-audio-400/60',
    label: 'text-audio-400',
    glow: 'from-audio-400/10',
  },
  beat: {
    border: 'border-beat-400/45',
    numeral: 'text-beat-400/60',
    label: 'text-beat-400',
    glow: 'from-beat-400/10',
  },
} as const;

export function StepCard({ number, label, detail, state, tone, onClick }: StepCardProps) {
  const done = state === 'done';
  const palette = TONE[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === 'busy' || state === 'disabled'}
      className={[
        // `overflow-hidden` borne le degrade au rayon de la carte.
        'surface relative flex min-h-36 w-full flex-col justify-between overflow-hidden',
        'rounded-2xl border bg-ink-850 p-4 text-left transition-colors',
        // 60 % et non 45: a 45 le libelle tombait a 4,1:1 — conforme, mais
        // visuellement eteint a cote des cartes actives. A 60 il reste
        // clairement lisible tout en se lisant comme indisponible.
        'active:bg-ink-800 disabled:opacity-60',
        done ? 'border-ok-400/60' : palette.border,
      ].join(' ')}
    >
      {/* Voile teinte tres discret: donne une identite a la carte sans nuire a
          la lisibilite du texte pose dessus. */}
      <span
        aria-hidden="true"
        className={[
          'pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent',
          done ? 'from-ok-400/10' : palette.glow,
        ].join(' ')}
      />

      <div className="relative flex items-start justify-between gap-3">
        <span
          className={[
            'text-xs font-semibold uppercase tracking-wide',
            done ? 'text-ok-400' : palette.label,
          ].join(' ')}
        >
          {label}
        </span>
        {done && (
          <span className="shrink-0 text-ok-400 [&>svg]:size-5">
            <CheckIcon />
          </span>
        )}
      </div>

      {/*
        Le numeral est decoratif: la carte est deja nommee par son libelle, et
        l'ordre est porte par le DOM. L'annoncer donnerait « IMPORTER AUDIO, 2 ».
      */}
      <span
        aria-hidden="true"
        className={[
          'tnum relative text-6xl font-bold leading-none',
          done ? 'text-ok-400/60' : palette.numeral,
        ].join(' ')}
      >
        {number}
      </span>

      {/* Hauteur reservee en permanence: sans cela, la carte sauterait au
          passage en « occupe » ou en « fait ». */}
      <span className="relative min-h-4 text-xs text-ink-300">{detail}</span>
    </button>
  );
}
