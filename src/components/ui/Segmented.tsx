interface SegmentedOption<T extends string | number> {
  value: T;
  /** Libelle deja traduit. */
  label: string;
}

interface SegmentedProps<T extends string | number> {
  /** Libelle du groupe, deja traduit. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  tone?: 'default' | 'beat';
}

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  tone = 'default',
}: SegmentedProps<T>) {
  const activeClass =
    tone === 'beat' ? 'bg-beat-400 text-ink-950' : 'bg-ink-700 text-ink-50';

  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-xl bg-ink-850 p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={[
              'min-h-9 flex-1 rounded-lg px-2 text-xs font-medium transition-colors',
              active ? activeClass : 'text-ink-400 active:bg-ink-800',
            ].join(' ')}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
