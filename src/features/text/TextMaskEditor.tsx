/**
 * Masque texte: les lettres laissent voir le montage, le reste est couvert.
 *
 * Un composant a part et non une section de `TextSheet`: un masque n'est pas une
 * incrustation. Presque aucun reglage de texte n'a de sens ici — ni animation,
 * ni karaoke, ni alignement — et les melanger aurait donne un panneau dont la
 * moitie des champs seraient sans effet selon un booleen.
 */

import { useTranslation } from 'react-i18next';

import { useProjectStore } from '../../store/useProjectStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { Segmented } from '../../components/ui/Segmented';
import { Slider } from '../../components/ui/Slider';
import { PlusIcon, TrashIcon } from '../../components/ui/icons';
import { FONT_CHOICES, FONT_STACKS, type FontChoice } from '../../domain/types';
import { formatDuration, formatPercent } from '../../lib/format';
import { GlyphPicker } from './GlyphPicker';

export function TextMaskEditor() {
  const { t, i18n } = useTranslation(['editor', 'common']);

  const masks = useProjectStore((state) => state.project.textMasks);
  const addTextMask = useProjectStore((state) => state.addTextMask);
  const updateTextMask = useProjectStore((state) => state.updateTextMask);
  const removeTextMask = useProjectStore((state) => state.removeTextMask);
  const currentTime = usePlaybackStore((state) => state.time);
  const setTime = usePlaybackStore((state) => state.setTime);

  /*
    Masque edite: celui que la TETE DE LECTURE traverse, sinon le premier.

    Bug corrige: le panneau editait toujours `masks[0]`, en expliquant que la
    liste servait a les faire se succeder dans le temps. Elle ne le pouvait
    pas — rien ne permettait d'atteindre un deuxieme masque, ni meme d'en
    creer un: le bouton « ajouter » disparaissait des qu'un masque existait.

    Un masque couvre toute la frame, donc en superposer deux au meme instant
    reste inutile; c'est bien leur SUCCESSION qui a du sens, et elle est
    desormais reellement possible.
  */
  const list = masks ?? [];
  const activeIndex = Math.max(
    0,
    list.findIndex(
      (entry) => currentTime >= entry.start && currentTime < entry.start + entry.duration,
    ),
  );
  const mask = list[activeIndex];

  if (!mask) {
    return (
      <section className="space-y-2 border-t border-ink-700 pt-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
          {t('editor:mask.title')}
        </h3>
        <p className="text-xs leading-relaxed text-ink-400">{t('editor:mask.hint')}</p>
        <button
          type="button"
          onClick={() => addTextMask('A', { start: currentTime })}
          className="surface flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-ink-600 text-xs font-medium text-ink-200 active:bg-ink-850 [&>svg]:size-4"
        >
          <PlusIcon />
          {t('editor:mask.add')}
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-4 border-t border-ink-700 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
          {t('editor:mask.title')}
        </h3>
        <div className="flex items-center gap-1">
          {/*
            Ajouter un masque reste possible meme quand il en existe deja: le
            bouton disparaissait, ce qui rendait le deuxieme masque
            inatteignable. Le nouveau demarre a la tete de lecture, la ou on
            regarde.
          */}
          <button
            type="button"
            onClick={() => addTextMask('A', { start: currentTime })}
            aria-label={t('editor:mask.add')}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-300 active:bg-ink-800 [&>svg]:size-4"
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            onClick={() => removeTextMask(mask.id)}
            aria-label={t('editor:mask.remove')}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-400 active:bg-ink-800 [&>svg]:size-4"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/*
        Selecteur, affiche seulement a partir de DEUX masques.

        A un seul, il n'apporterait qu'une ligne de decor. Chaque entree porte
        son contenu et son instant: c'est ce qui permet de reconnaitre celui
        qu'on cherche sans le selectionner d'abord.
      */}
      {list.length > 1 && (
        <div
          role="radiogroup"
          aria-label={t('editor:mask.title')}
          className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1"
        >
          {list.map((entry, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={active}
                // Se placer sur le masque le selectionne: la tete de lecture
                // est deja ce qui decide lequel est edite.
                onClick={() => setTime(entry.start)}
                className={[
                  'flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-media-400/60 bg-media-400/15 text-media-400'
                    : 'surface border-ink-600 bg-ink-850 text-ink-300 active:bg-ink-800',
                ].join(' ')}
              >
                <span className="max-w-[4rem] truncate text-sm">{entry.text}</span>
                <span className="tnum text-[10px] opacity-70">
                  {formatDuration(entry.start, i18n.language)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-400">
          {t('editor:mask.content')}
        </span>
        <input
          type="text"
          value={mask.text}
          onChange={(event) => updateTextMask(mask.id, { text: event.target.value })}
          className="min-h-11 w-full rounded-xl border border-ink-600 bg-ink-850 px-3 text-lg font-semibold text-ink-50"
        />
        {/* Un masque tient son effet de sa demesure: on le dit plutot que de
            laisser l'utilisateur saisir une phrase qui ne rendra rien. */}
        <span className="mt-1 block text-xs text-ink-400">{t('editor:mask.contentHint')}</span>
      </label>

      {/*
        Bibliotheque de formes: elle REMPLACE le contenu au lieu de s'y ajouter.

        Un masque tient en une ou deux formes — au-dela les lettres deviennent
        trop etroites pour laisser voir l'image. Concatener produirait donc
        surtout des masques illisibles; remplacer donne un aperçu immediat de
        chaque forme, ce qui est l'usage reel: on essaie, on compare.
      */}
      <GlyphPicker onPick={(glyph) => updateTextMask(mask.id, { text: glyph })} />

      {/* `Segmented` ne prend que des chaines ou des nombres: le booleen du
          modele est traduit ici plutot que d'elargir le composant partage. */}
      <Segmented
        label={t('editor:mask.mode')}
        options={[
          { value: 'cutout' as const, label: t('editor:mask.modeCutout') },
          { value: 'filled' as const, label: t('editor:mask.modeFilled') },
        ]}
        value={mask.inverted ? 'filled' : 'cutout'}
        onChange={(mode) => updateTextMask(mask.id, { inverted: mode === 'filled' })}
      />

      <div>
        <span className="mb-1.5 block text-xs font-medium text-ink-400">
          {t('editor:text.font')}
        </span>
        <div className="grid grid-cols-3 gap-2">
          {FONT_CHOICES.map((font: FontChoice) => (
            <button
              key={font}
              type="button"
              onClick={() =>
                updateTextMask(mask.id, { font, fontFamily: FONT_STACKS[font] })
              }
              aria-pressed={mask.font === font}
              style={{ fontFamily: FONT_STACKS[font] }}
              className={[
                'min-h-11 rounded-lg border px-2 text-xs font-medium',
                mask.font === font
                  ? 'border-beat-400 text-beat-400'
                  : 'border-ink-600 text-ink-200 active:bg-ink-800',
              ].join(' ')}
            >
              {t(`editor:text.fontName.${font}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-ink-400">
          {mask.inverted ? t('editor:mask.letterColor') : t('editor:mask.fillColor')}
        </span>
        <label className="relative size-11 shrink-0 overflow-hidden rounded-full border-2 border-ink-600">
          <span className="sr-only">{t('editor:mask.fillColor')}</span>
          <input
            type="color"
            value={mask.fillColor}
            onChange={(event) => updateTextMask(mask.id, { fillColor: event.target.value })}
            className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0"
          />
        </label>
      </div>

      {/*
        Transparence, exprimee en POURCENTAGE cote interface.

        Le modele stocke une opacite dans [0, 1], mais « 40 % » se lit mieux que
        « 0,4 » sur un reglage qu'on ajuste a l'oeil.
      */}
      <Slider
        label={t('editor:mask.opacity')}
        value={mask.fillOpacity}
        min={0}
        max={1}
        step={0.05}
        displayValue={formatPercent(mask.fillOpacity, i18n.language)}
        onChange={(fillOpacity) => updateTextMask(mask.id, { fillOpacity })}
      />

      <Slider
        label={t('editor:text.size')}
        value={mask.fontSize}
        min={0.1}
        // Jusqu'a 1,5 fois la largeur de frame: une lettre qui deborde du cadre
        // est un parti pris courant, et le brider a 1 l'interdirait.
        max={1.5}
        step={0.02}
        onChange={(fontSize) => updateTextMask(mask.id, { fontSize })}
      />

      <Slider
        label={t('editor:text.positionX')}
        value={mask.x}
        min={0}
        max={1}
        step={0.01}
        onChange={(x) => updateTextMask(mask.id, { x })}
      />

      <Slider
        label={t('editor:text.positionY')}
        value={mask.y}
        min={0}
        max={1}
        step={0.01}
        onChange={(y) => updateTextMask(mask.id, { y })}
      />

      <Slider
        label={t('editor:text.rotation')}
        value={mask.rotation}
        min={-0.35}
        max={0.35}
        step={0.01}
        onChange={(rotation) => updateTextMask(mask.id, { rotation })}
      />

      <Slider
        label={t('editor:mask.duration')}
        value={mask.duration}
        min={0.5}
        max={30}
        step={0.5}
        onChange={(duration) => updateTextMask(mask.id, { duration })}
      />
    </section>
  );
}
