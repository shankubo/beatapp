/**
 * Bibliotheque de formes, en grille, pour remplir un masque de texte.
 *
 * Le clavier emoji du systeme etait la seule voie: il propose surtout des
 * caracteres qui ne DECOUPENT rien — marques combinantes rendues en cercle
 * pointille, glyphes absents des polices rendus en carre vide. Ici chaque forme
 * est choisie pour sa silhouette (voir `maskGlyphs.ts`), et un appui l'insere.
 *
 * Repliee par defaut: elle accompagne un champ de saisie qui reste utilisable
 * seul, et depliee en permanence elle repousserait tous les reglages du masque
 * hors de l'ecran.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChevronDownIcon, ChevronUpIcon } from '../../components/ui/icons';
import { GLYPH_GROUPS } from './maskGlyphs';

export function GlyphPicker({ onPick }: { onPick: (glyph: string) => void }) {
  const { t } = useTranslation(['editor']);
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(0);

  const current = GLYPH_GROUPS[group] ?? GLYPH_GROUPS[0]!;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="surface flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-ink-600 text-xs font-medium text-ink-200 active:bg-ink-850 [&>svg]:size-4"
      >
        {t('editor:mask.library')}
        {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
      </button>

      {open && (
        <div className="space-y-2">
          {/*
            Categories en `radiogroup`: elles s'excluent, et c'est ce qu'un
            lecteur d'ecran doit annoncer.
          */}
          <div
            role="radiogroup"
            aria-label={t('editor:mask.library')}
            className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1"
          >
            {GLYPH_GROUPS.map((entry, index) => {
              const active = index === group;
              return (
                <button
                  key={entry.labelKey}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setGroup(index)}
                  className={[
                    'min-h-9 shrink-0 rounded-lg border px-2.5 text-[11px] font-medium transition-colors',
                    active
                      ? 'border-media-400/60 bg-media-400/15 text-media-400'
                      : 'surface border-ink-600 bg-ink-850 text-ink-300 active:bg-ink-800',
                  ].join(' ')}
                >
                  {t(entry.labelKey)}
                </button>
              );
            })}
          </div>

          {/*
            Grille a colonnes variables plutot qu'un nombre fixe: le meme motif
            que la grille de medias, pour que rien ne deborde sur 390 px.
          */}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1">
            {current.glyphs.map((glyph) => (
              <li key={glyph}>
                <button
                  type="button"
                  onClick={() => onPick(glyph)}
                  // Le glyphe EST le libelle: pas d'`aria-label` qui le
                  // doublerait en le nommant moins bien que sa propre forme.
                  className="surface flex size-11 items-center justify-center rounded-lg border border-ink-700 bg-ink-850 text-lg text-ink-50 active:bg-ink-800"
                >
                  {glyph}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
