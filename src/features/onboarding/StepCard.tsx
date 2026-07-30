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
  /** Base du nom de fichier de l'illustration, sans largeur ni extension. */
  image: string;
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

export function StepCard({ number, label, detail, state, tone, image, onClick }: StepCardProps) {
  const done = state === 'done';
  const palette = TONE[tone];
  // Chemin prefixe par `import.meta.env.BASE_URL`, jamais ecrit en dur: sous un
  // sous-chemin (https://app.francotamouls.com/beatapp/), une racine « /steps/… »
  // viserait le domaine et l'image manquerait.
  const base = `${import.meta.env.BASE_URL}steps/${image}`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === 'busy' || state === 'disabled'}
      className={[
        // `overflow-hidden` borne le degrade ET l'illustration au rayon de la carte.
        'surface relative flex w-full flex-col overflow-hidden',
        'rounded-2xl border bg-ink-850 text-left transition-colors',
        // 60 % et non 45: a 45 le libelle tombait a 4,1:1 — conforme, mais
        // visuellement eteint a cote des cartes actives. A 60 il reste
        // clairement lisible tout en se lisant comme indisponible.
        'active:bg-ink-800 disabled:opacity-60',
        done ? 'border-ok-400/60' : palette.border,
      ].join(' ')}
    >
      {/*
        Illustration de l'etape: elle MONTRE l'operation la ou le libelle la
        nomme. Ratio fixe et `object-cover` — les trois sources ont des cadrages
        de formes differentes, et sans hauteur imposee les cartes ne
        s'aligneraient pas.

        `alt` vide et `aria-hidden`: purement decorative, l'etape etant deja
        annoncee par son libelle. La decrire ferait lire deux fois la meme chose.
      */}
      {/*
        Bande de 96 px et non un ratio: en `aspect-video`, les trois cartes
        mesuraient ~530 px de haut a elles seules et la troisieme etape tombait
        sous la ligne de flottaison — sur l'ecran meme qui promet « en 3 etapes ».
      */}
      <span aria-hidden="true" className="relative block h-24 w-full overflow-hidden">
        <img
          src={`${base}-720.webp`}
          srcSet={`${base}-360.webp 360w, ${base}-720.webp 720w`}
          // La carte occupe la largeur de l'ecran moins les marges de la page.
          sizes="(min-width: 640px) 592px, calc(100vw - 32px)"
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
        {/*
          Fondu vers le fond de la carte sur le bas de l'image: sans lui, le
          bord franc de l'illustration coupait la carte en deux blocs etrangers
          l'un a l'autre.
        */}
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-850 via-transparent to-transparent" />
      </span>

      {/* Voile teinte tres discret: donne une identite a la carte sans nuire a
          la lisibilite du texte pose dessus. */}
      <span
        aria-hidden="true"
        className={[
          'pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent',
          done ? 'from-ok-400/10' : palette.glow,
        ].join(' ')}
      />

      <div className="relative flex items-start gap-3 p-4">
        {/*
          Le numeral est decoratif: la carte est deja nommee par son libelle, et
          l'ordre est porte par le DOM. L'annoncer donnerait « IMPORTER AUDIO, 2 ».

          Pose a cote du texte et non plus au-dessus: l'illustration occupe
          desormais le haut de la carte, ou il tenait sa taille d'affiche.
        */}
        <span
          aria-hidden="true"
          className={[
            'tnum shrink-0 text-4xl font-bold leading-none',
            done ? 'text-ok-400/60' : palette.numeral,
          ].join(' ')}
        >
          {number}
        </span>

        <div className="min-w-0 flex-1">
          <span
            className={[
              'block text-xs font-semibold uppercase tracking-wide',
              done ? 'text-ok-400' : palette.label,
            ].join(' ')}
          >
            {label}
          </span>
          {/* Hauteur reservee en permanence: sans cela, la carte sauterait au
              passage en « occupe » ou en « fait ». */}
          <span className="mt-1 block min-h-4 text-xs text-ink-300">{detail}</span>
        </div>

        {done && (
          <span className="shrink-0 text-ok-400 [&>svg]:size-5">
            <CheckIcon />
          </span>
        )}
      </div>
    </button>
  );
}
