/**
 * Confirmation d'une action destructive.
 *
 * On n'utilise pas `window.confirm`: il est bloque dans certains contextes PWA,
 * ne se traduit pas, et sur mobile il ressemble a une alerte du navigateur
 * plutot qu'a une decision dans l'application.
 *
 * Le dialogue est modal au sens de l'accessibilite: `role="dialog"`,
 * `aria-modal`, focus place sur l'action de repli (annuler) a l'ouverture — pour
 * qu'une validation reflexe au clavier ne detruise rien.
 */

import { useEffect, useRef, type ReactNode } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  /** Titre deja traduit. */
  title: string;
  /** Explication de la consequence, deja traduite. */
  description: ReactNode;
  /** Libelle de l'action destructive, deja traduit. */
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Le focus va sur « Annuler »: l'action par defaut ne doit jamais etre celle
  // qui detruit le travail.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 pb-8"
      // Un clic sur le voile annule: c'est le geste de sortie attendu, et il est
      // toujours du cote non destructif.
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Sans cela, le clic dans le dialogue remonterait au voile et fermerait.
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-ink-600 bg-ink-900 p-4"
      >
        <h2 className="text-base font-semibold tracking-tight text-ink-50">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-300">{description}</p>

        <div className="mt-4 flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="min-h-12 flex-1 rounded-xl border border-ink-600 text-sm font-medium text-ink-200 active:bg-ink-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-12 flex-1 rounded-xl bg-danger-500 text-sm font-semibold text-ink-950 active:brightness-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
