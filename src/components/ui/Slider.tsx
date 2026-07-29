interface SliderProps {
  /** Libelle deja traduit. */
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Valeur formatee affichee a droite (deja localisee). */
  displayValue?: string;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  displayValue,
}: SliderProps) {
  return (
    <label className="block py-2">
      <span className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium text-ink-400">{label}</span>
        {displayValue !== undefined && (
          <span className="tnum text-xs text-ink-200">{displayValue}</span>
        )}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        // `accent-color` suffit et respecte le rendu natif de chaque plateforme:
        // reconstruire un curseur en div casserait l'accessibilite clavier.
        className="h-11 w-full accent-[var(--color-beat-400)]"
      />
    </label>
  );
}
