/**
 * Icones en SVG inline.
 *
 * Pas de librairie d'icones: une quinzaine de glyphes ne justifie pas une
 * dependance, et la CSP interdit de toute facon tout chargement externe.
 * `currentColor` partout, pour que la couleur vienne du bouton parent.
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" />
      <rect x="13.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" />
    </svg>
  );
}

export function SkipBackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 6v12L8 12z" fill="currentColor" />
      <rect x="5" y="6" width="2" height="12" rx="1" fill="currentColor" />
    </svg>
  );
}

export function SkipForwardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 6v12l9-6z" fill="currentColor" />
      <rect x="17" y="6" width="2" height="12" rx="1" fill="currentColor" />
    </svg>
  );
}

export function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M4 9h11a4.5 4.5 0 0 1 0 9H9" />
      <path d="M7.5 5.5 4 9l3.5 3.5" />
    </svg>
  );
}

export function RedoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M20 9H9a4.5 4.5 0 0 0 0 9h6" />
      <path d="M16.5 5.5 20 9l-3.5 3.5" />
    </svg>
  );
}

export function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M9 3.5H3.5V9M15 3.5h5.5V9M9 20.5H3.5V15M15 20.5h5.5V15" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function UnlockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      {/* Anse ouverte vers la droite: le contraste avec le cadenas ferme doit
          etre lisible a 16 px. */}
      <path d="M8 10.5V7.5a4 4 0 0 1 7.5-1.9" />
    </svg>
  );
}

/** Aimant en fer a cheval, avec ses deux poles. */
export function MagnetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M7 20.5V11a5 5 0 0 1 10 0v9.5" />
      <path d="M4.5 20.5h5M14.5 20.5h5" />
      <path d="M7 15.5h2.5M14.5 15.5H17" />
    </svg>
  );
}

export function ScissorsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <circle cx="6" cy="6.5" r="2.5" />
      <circle cx="6" cy="17.5" r="2.5" />
      <path d="M8.2 8.1 20 19M8.2 15.9 20 5" />
    </svg>
  );
}

export function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="M15.5 10.5l6-3.5v10l-6-3.5z" />
    </svg>
  );
}

export function PhotoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l4.5-4.2a2 2 0 0 1 2.7 0L20 20" />
    </svg>
  );
}

export function MusicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <circle cx="7" cy="17.5" r="2.5" />
      <circle cx="17.5" cy="15" r="2.5" />
      <path d="M9.5 17.5V7l10.5-2.5V15" />
    </svg>
  );
}

export function TextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M5 6h14" />
      <path d="M12 6v13" />
      <path d="M9 19h6" />
    </svg>
  );
}

export function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M12 3.5l1.7 4.9 4.8 1.6-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.6z" />
      <path d="M18.5 16.5l.7 1.9 1.8.6-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.6z" />
    </svg>
  );
}

/** Icone du rythme: des barres de hauteurs inegales, comme un VU-metre. */
export function BeatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="9" width="2.5" height="6" rx="1.2" fill="currentColor" />
      <rect x="8.75" y="4.5" width="2.5" height="15" rx="1.2" fill="currentColor" />
      <rect x="13.5" y="7.5" width="2.5" height="9" rx="1.2" fill="currentColor" />
      <rect x="18.25" y="10.5" width="2.5" height="3" rx="1.2" fill="currentColor" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  );
}

/*
  Loupes: le cercle et le manche sont communs, seul le signe interieur change.

  Une loupe plutot qu'un simple `+` / `-`: pose sur l'image, un `+` nu se lit
  comme « ajouter un media », ce que la barre du bas propose deja juste a cote.
*/
export function ZoomInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L20.5 20.5" />
      <path d="M10.5 7.5v6M7.5 10.5h6" />
    </svg>
  );
}

export function ZoomOutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L20.5 20.5" />
      <path d="M7.5 10.5h6" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.5 7l.8 11.2A1.8 1.8 0 0 0 9.1 20h5.8a1.8 1.8 0 0 0 1.8-1.8L17.5 7" />
    </svg>
  );
}

/**
 * Mode compact: deux fleches qui se rapprochent des bords.
 *
 * Le contraire visuel d'`ExpandIcon`, qui les ecarte — le rapprochement dit que
 * le decor se replie sur les bords plutot que de manger l'image.
 */
export function CompactIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M4 4.5h16M4 19.5h16" />
      <path d="M12 8.5v-3M10 7l2-2 2 2" />
      <path d="M12 15.5v3M10 17l2 2 2-2" />
    </svg>
  );
}

/** Quart de tour vers la gauche (sens antihoraire). */
export function RotateLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      {/* Arc ouvert en haut a gauche, avec sa pointe de fleche. */}
      <path d="M4 9a8.5 8.5 0 1 1 1.2 8" />
      <path d="M4 4.5V9h4.5" />
    </svg>
  );
}

/** Quart de tour vers la droite (sens horaire). */
export function RotateRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M20 9a8.5 8.5 0 1 0-1.2 8" />
      <path d="M20 4.5V9h-4.5" />
    </svg>
  );
}

/** Curseurs de reglage: plus lisible qu'une roue dentee a 16 px. */
export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M5 7h14M5 12h14M5 17h14" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <circle cx="12" cy="12" r="9" />
      {/* Le point et la hampe sont deux traces distincts: un « i » d'un seul
          trait se lirait comme un point d'exclamation a petite taille. */}
      <path d="M12 11v5" />
      <path d="M12 7.75h.01" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

export function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M12 15.5V4" />
      <path d="M8.5 7.5 12 4l3.5 3.5" />
      <path d="M5.5 13v5.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V13" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M12 4v11.5" />
      <path d="M8.5 12 12 15.5 15.5 12" />
      <path d="M5.5 18.5h13" />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M6.5 10l5.5 5 5.5-5" />
    </svg>
  );
}

export function ChevronUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M6.5 14l5.5-5 5.5 5" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M14 6.5L8.5 12l5.5 5.5" />
    </svg>
  );
}

export function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M10 6.5l5.5 5.5-5.5 5.5" />
    </svg>
  );
}

/** Deux fleches opposees: remplacer un media par un autre. */
export function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M4 8.5h13l-3-3M20 15.5H7l3 3" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5.5H6a1.5 1.5 0 00-1.5 1.5v9" />
    </svg>
  );
}

/** Ciseaux: la coupe d'un segment audio. */
export function CutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <circle cx="7" cy="18" r="2.5" />
      <circle cx="17" cy="18" r="2.5" />
      <path d="M8.8 16.2L18 4M15.2 16.2L6 4" />
    </svg>
  );
}

/** Lien: import depuis une URL. */
export function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M10.5 13.5a3.5 3.5 0 015 0l2.5 2.5a3.5 3.5 0 01-5 5L11 19" />
      <path d="M13.5 10.5a3.5 3.5 0 01-5 0L6 8a3.5 3.5 0 015-5L13 5" />
    </svg>
  );
}

/** Guillemets: les paroles synchronisees. */
export function LyricsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M5 6.5h14M5 11h9M5 15.5h11M5 20h6" />
    </svg>
  );
}
