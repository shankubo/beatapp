/**
 * Messages transitoires.
 *
 * Les toasts portent une CLE i18n, pas un message: la traduction se fait ici,
 * au moment de l'affichage. Un message deja traduit stocke dans l'etat ne
 * changerait pas de langue si l'utilisateur bascule en cours de route.
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useUiStore, type Toast } from '../../store/useUiStore';

const AUTO_DISMISS_MS = 4000;
/** Plus long quand une annulation est proposee: il faut le temps de la lire. */
const AUTO_DISMISS_WITH_UNDO_MS = 6000;

export function Toaster() {
  const toasts = useUiStore((state) => state.toasts);

  return (
    <div
      // `pointer-events-none` sur le conteneur: les toasts ne doivent pas
      // intercepter les gestes de la timeline en dessous.
      className="pointer-events-none absolute inset-x-0 bottom-0 z-50 flex flex-col gap-2 p-3"
      aria-live="polite"
      role="status"
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastRow({ toast }: { toast: Toast }) {
  // Les memes namespaces que `ToastKey`, dans le meme ordre: c'est ce qui
  // rend la cle du toast acceptable par `t()` sans assertion. Ajouter une cle
  // de toast dans un namespace absent d'ici la rendrait irresoluble — erreur
  // de compilation, mais dont le message pointe ce fichier et non le coupable.
  const { t } = useTranslation(['common', 'editor', 'errors', 'samples']);
  const dismiss = useUiStore((state) => state.dismissToast);

  useEffect(() => {
    const delay = toast.undo ? AUTO_DISMISS_WITH_UNDO_MS : AUTO_DISMISS_MS;
    const timer = setTimeout(() => dismiss(toast.id), delay);
    return () => clearTimeout(timer);
  }, [toast.id, toast.undo, dismiss]);

  return (
    <div
      className={[
        'pointer-events-auto flex items-center gap-3 rounded-xl border px-3 py-2.5 shadow-lg',
        toast.tone === 'error'
          ? 'border-danger-500/40 bg-ink-850 text-danger-400'
          : 'border-ink-600 bg-ink-850 text-ink-200',
      ].join(' ')}
    >
      {/*
        Traduction elargie a `string`.

        `t` est surchargee, et son typage strict des cles ne sait pas resoudre
        une union melant des cles a parametres et des cles sans: la surcharge
        `t(cle, valeurParDefaut)` devient candidate et le `Record` de parametres
        se retrouve compare a une chaine. Les cles restent verifiees en amont —
        `ToastKey` est une union fermee, et `i18n:check` garantit qu'elles
        existent dans les trois langues.
      */}
      <span className="flex-1 text-sm">
        {(t as (key: string, params?: Record<string, string | number>) => string)(
          toast.i18nKey,
          toast.params ?? {},
        )}
      </span>

      {toast.undo && (
        <button
          type="button"
          onClick={() => {
            toast.undo?.();
            dismiss(toast.id);
          }}
          className="min-h-9 shrink-0 rounded-lg px-2 text-sm font-semibold text-beat-400"
        >
          {t('common:action.undo')}
        </button>
      )}
    </div>
  );
}
