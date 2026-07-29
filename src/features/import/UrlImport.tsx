/**
 * Import par lien.
 *
 * L'avertissement sur les reseaux sociaux est affiche DES QUE l'utilisateur
 * colle une adresse Instagram ou TikTok, avant qu'il n'appuie sur Importer:
 * echouer d'abord pour expliquer ensuite ferait croire a un bug de
 * l'application, alors que c'est une limite du navigateur.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { UrlImportError, importFromUrl, isBlockedMediaHost } from './importUrl';
import { ImportError } from './importMedia';
import { useMedia } from '../preview/MediaProvider';
import { useUiStore } from '../../store/useUiStore';
import { LinkIcon } from '../../components/ui/icons';
import type { MediaAsset, MediaKind } from '../../domain/types';

interface UrlImportProps {
  /** Types acceptes: restreint l'import au contexte du panneau. */
  accept: readonly MediaKind[];
  /** Appele avec le media importe, deja enregistre dans le cache et le stockage. */
  onImported: (asset: MediaAsset) => void;
}

export function UrlImport({ accept, onImported }: UrlImportProps) {
  const { t } = useTranslation(['editor', 'errors']);

  const { register } = useMedia();
  const pushToast = useUiStore((state) => state.pushToast);

  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  // Derive, jamais stocke: sinon l'avertissement resterait affiche apres
  // correction de l'adresse.
  const blocked = url.trim().length > 0 && isBlockedMediaHost(url);

  const handleImport = async () => {
    setBusy(true);
    try {
      const { asset, blob } = await importFromUrl(url, { accept });
      await register(asset, blob);
      onImported(asset);
      // Champ vide apres succes: l'adresse a fait son office.
      setUrl('');
    } catch (error) {
      const key =
        error instanceof UrlImportError || error instanceof ImportError
          ? error.i18nKey
          : 'errors:url.fetchFailed';
      const params =
        error instanceof UrlImportError || error instanceof ImportError ? error.params : {};
      pushToast({ i18nKey: key, params, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
        {t('editor:url.title')}
      </h3>

      <label className="block">
        <span className="sr-only">{t('editor:url.label')}</span>
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={t('editor:url.placeholder')}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className="min-h-12 w-full rounded-xl border border-ink-600 bg-ink-850 px-3 text-sm text-ink-50 outline-none placeholder:text-ink-400 focus:border-beat-400"
        />
      </label>

      {blocked ? (
        <p className="rounded-xl border border-danger-500/40 bg-danger-500/5 p-3 text-xs leading-relaxed text-ink-200">
          {t('editor:url.socialWarning')}
        </p>
      ) : (
        <p className="text-xs text-ink-400">{t('editor:url.hint')}</p>
      )}

      <button
        type="button"
        onClick={() => void handleImport()}
        disabled={busy || blocked || url.trim().length === 0}
        className="flex min-h-12 w-full items-center justify-center gap-2 surface rounded-xl border border-ink-600 bg-ink-850 text-sm font-medium text-ink-50 active:bg-ink-800 disabled:opacity-60 [&>svg]:size-4"
      >
        <LinkIcon />
        {busy ? t('editor:url.importing') : t('editor:url.import')}
      </button>
    </section>
  );
}
