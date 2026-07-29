/**
 * Import d'un fond de couleur unie.
 *
 * Le bouton deplie une grille de vignettes: taper une couleur cree un media
 * image et l'ajoute au montage, exactement comme une photo importee. C'est ce qui
 * rend la fonction utile sans rien ajouter en aval — le compositeur, la timeline
 * et l'export ne savent meme pas qu'il s'agit d'une couleur.
 *
 * Un champ de couleur libre complete la palette: le selecteur natif est la seule
 * roue chromatique utilisable au doigt sans en reecrire une.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  COLOR_SWATCHES,
  colorAssetMetadata,
  normalizeHex,
  renderColorBlob,
} from './colorSwatches';
import { PlusIcon } from '../../components/ui/icons';
import { newId } from '../../lib/id';
import type { MediaAsset } from '../../domain/types';

interface ColorImportProps {
  /** Enregistre le blob et le rend disponible au rendu. */
  onImported: (asset: MediaAsset, blob: Blob) => Promise<void> | void;
  onError: () => void;
  disabled?: boolean;
}

export function ColorImport({ onImported, onError, disabled = false }: ColorImportProps) {
  const { t } = useTranslation(['editor', 'common']);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Couleur du champ libre. Un etat local suffit: elle n'existe que le temps du
  // choix, et rien en aval n'a besoin de s'en souvenir.
  const [custom, setCustom] = useState('#3b82f6');
  const customInput = useRef<HTMLInputElement>(null);

  const add = async (hex: string) => {
    const normalized = normalizeHex(hex);
    if (!normalized) {
      onError();
      return;
    }

    setBusy(true);
    try {
      const blob = await renderColorBlob(normalized);
      const asset: MediaAsset = {
        ...colorAssetMetadata(normalized, blob),
        id: newId('asset'),
        // Meme convention que les autres imports: la cle de stockage derive de
        // l'identifiant, pas de la couleur — deux fonds identiques restent deux
        // medias distincts et se suppriment independamment.
        storage: { backend: 'idb', key: `${newId('media')}.bin` },
      };
      await onImported(asset, blob);
    } catch {
      onError();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-center gap-2 surface rounded-xl border border-ink-600 bg-ink-850 px-3 text-sm font-medium text-ink-50 active:bg-ink-800 disabled:opacity-60 [&>svg]:size-4"
      >
        <PlusIcon />
        {t('editor:media.importColors')}
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-xl border border-ink-600 bg-ink-850 p-3">
          <p className="text-xs leading-relaxed text-ink-400">
            {t('editor:media.colorsHint')}
          </p>

          {/*
            Grille a nombre de colonnes VARIABLE, comme les vignettes de media:
            un nombre fixe donnerait des pastilles enormes sur un ecran large.
          */}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-2">
            {COLOR_SWATCHES.map((swatch) => (
              <li key={swatch.id}>
                <button
                  type="button"
                  onClick={() => void add(swatch.hex)}
                  disabled={busy}
                  // Le nom traduit sert de libelle: une pastille de couleur sans
                  // texte est invisible pour un lecteur d'ecran.
                  aria-label={t(swatch.nameKey)}
                  title={t(swatch.nameKey)}
                  // La bordure claire est indispensable: sans elle, le noir et le
                  // blanc se fondraient respectivement dans le panneau et se
                  // confondraient entre eux.
                  className="block aspect-square w-full rounded-lg border border-ink-600 active:border-beat-400 disabled:opacity-60"
                  style={{ backgroundColor: swatch.hex }}
                />
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2 border-t border-ink-700 pt-3">
            <label className="relative size-11 shrink-0 overflow-hidden rounded-lg border border-ink-600">
              <span className="sr-only">{t('editor:media.customColor')}</span>
              <input
                ref={customInput}
                type="color"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                // Le champ natif est agrandi et decale pour que sa pastille
                // remplisse tout le carre.
                className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0"
              />
            </label>

            <button
              type="button"
              onClick={() => void add(custom)}
              disabled={busy}
              className="min-h-11 flex-1 rounded-xl bg-beat-400 text-sm font-semibold text-ink-950 active:bg-beat-500 disabled:opacity-60"
            >
              {busy ? t('common:state.loading') : t('editor:media.addColor')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
