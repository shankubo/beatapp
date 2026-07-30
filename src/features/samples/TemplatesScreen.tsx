/**
 * Page « Modeles de reels ».
 *
 * Les modeles existaient deja, mais rendus tout en bas de la feuille Media, sous
 * toute la liste des medias — donc invisibles en pratique. Et les cinq
 * affichaient la meme icone: rien ne distinguait « Coupes rapides » (8 s, une
 * image par demi-temps) d'un « Voyage cinematique » (20 s, plans longs).
 *
 * Deux vues dans la MEME page plutot qu'une modale par-dessus: cet ecran est
 * deja en `z-40` plein cadre, empiler une seconde couche par-dessus ne servirait
 * qu'a compliquer la fermeture.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TEMPLATES } from './templates';
import { TemplateThumb } from './TemplateThumb';
import { TemplateDetail } from './TemplateDetail';
import { IconButton } from '../../components/ui/IconButton';
import { ArrowLeftIcon, CloseIcon } from '../../components/ui/icons';
import { formatInteger } from '../../lib/format';
import type { Template } from '../../domain/template';

export function TemplatesScreen({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation(['samples', 'common']);
  const [selected, setSelected] = useState<Template | null>(null);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-ink-950">
      <header className="safe-pt flex h-appbar shrink-0 items-center justify-between gap-1 border-b border-ink-700 pl-1 pr-1">
        {/*
          Le retour remplace le titre quand un modele est ouvert: sur 390 px, un
          titre plus une fleche plus une croix saturent la barre.
        */}
        {selected ? (
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-ink-200 active:bg-ink-800 [&>svg]:size-4"
          >
            <ArrowLeftIcon />
            {t('samples:templates.back')}
          </button>
        ) : (
          <h2 className="pl-3 text-sm font-semibold text-ink-50">
            {t('samples:templates.title')}
          </h2>
        )}

        <IconButton label={t('common:action.close')} onClick={onClose} size="sm">
          <CloseIcon />
        </IconButton>
      </header>

      <div className="scrollbar-none safe-pb min-h-0 flex-1 overflow-y-auto p-4">
        {selected ? (
          <TemplateDetail template={selected} onApplied={onClose} />
        ) : (
          <>
            <p className="mb-3 text-sm leading-relaxed text-ink-400">
              {t('samples:templates.intro')}
            </p>

            {/*
              Colonnes variables plutot qu'un `grid-cols-2` fige: le meme motif
              que la grille de medias. Sur un ecran large, deux colonnes fixes
              donneraient des cartes enormes.
            */}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
              {TEMPLATES.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(template)}
                    className="flex w-full flex-col gap-2 rounded-xl border border-ink-600 bg-ink-850 p-3 text-left active:bg-ink-800"
                  >
                    <TemplateThumb template={template} />

                    <span className="block text-sm font-medium text-ink-50">
                      {t(template.nameKey)}
                    </span>
                    <span className="block text-xs leading-relaxed text-ink-400">
                      {t(template.descriptionKey)}
                    </span>

                    {/* Faits chiffres: la duree et le nombre de photos attendu. */}
                    <span className="tnum block text-[11px] text-ink-400">
                      {t('samples:templates.duration', {
                        value: formatInteger(template.targetDuration, i18n.language),
                      })}
                      {' · '}
                      {t('samples:templates.clipsHint', { count: template.suggestedClips })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
