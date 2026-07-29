import type { ReactNode } from 'react';

interface IconButtonProps {
  /** Libelle accessible. Deja traduit par l'appelant. */
  label: string;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  /** `beat` reserve aux actions rythmiques; `danger` au destructif. */
  tone?: 'default' | 'beat' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  pressed?: boolean;
}

const SIZES = {
  // Toujours au moins 44px de cible tactile, quelle que soit la taille visuelle.
  sm: 'size-11 [&>svg]:size-4',
  md: 'size-11 [&>svg]:size-5',
  lg: 'size-14 [&>svg]:size-7',
} as const;

const TONES = {
  default: 'text-ink-200 active:bg-ink-800',
  beat: 'text-beat-400 active:bg-beat-400/15',
  danger: 'text-danger-500 active:bg-danger-500/15',
} as const;

export function IconButton({
  label,
  onClick,
  children,
  disabled,
  tone = 'default',
  size = 'md',
  pressed,
}: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      className={[
        'inline-flex items-center justify-center rounded-xl transition-colors',
        'disabled:opacity-60 disabled:pointer-events-none',
        SIZES[size],
        TONES[tone],
        pressed ? 'bg-ink-800' : '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
