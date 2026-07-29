/**
 * Paroles synchronisees.
 *
 * Ce qui est automatise ici, c'est le CALAGE — la partie reellement penible. On
 * colle les paroles, une ligne par phrase, et chaque ligne se pose sur la grille
 * rythmique deja detectee.
 *
 * Coller est le chemin PRINCIPAL et le seul entierement hors ligne. Trois autres
 * entrees sont proposees par `LyricsSources` (fichier `.lrc`/`.srt`, dictee au
 * micro, transcription par Gemini); elles produisent du texte ou des lignes deja
 * datees, puis rejoignent ce meme editeur.
 *
 * Les lignes sont rendues par le meme `TextRenderer` que les textes libres:
 * aucune voie de dessin supplementaire, donc aucun risque de divergence entre
 * l'apercu et l'export.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectStore } from '../../store/useProjectStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { LyricsSources } from './LyricsSources';
import { Slider } from '../../components/ui/Slider';
import { TrashIcon } from '../../components/ui/icons';
import { activeLyricIndex } from '../../domain/lyrics';
import { KARAOKE_SUNG_COLOR } from '../../domain/project';
import { FONT_CHOICES, FONT_STACKS } from '../../domain/types';

/**
 * Couleurs de surlignage proposees.
 *
 * Une selection courte de teintes qui restent lisibles sur n'importe quelle
 * image, plutot qu'une roue chromatique: le contraste avec la couleur d'attente
 * est ce qui fait fonctionner le karaoke, et toutes les teintes n'y arrivent pas.
 */
const KARAOKE_COLORS = [KARAOKE_SUNG_COLOR, '#ffffff', '#4cc9f0', '#ff5c38'] as const;
import { formatDuration } from '../../lib/format';

export function LyricsEditor() {
  const { t, i18n } = useTranslation(['editor', 'common']);

  const project = useProjectStore((state) => state.project);
  const setLyricsFromText = useProjectStore((state) => state.setLyricsFromText);
  const updateLyrics = useProjectStore((state) => state.updateLyrics);
  const setLyricsFont = useProjectStore((state) => state.setLyricsFont);
  const updateLyricLine = useProjectStore((state) => state.updateLyricLine);
  const removeLyricLine = useProjectStore((state) => state.removeLyricLine);
  const realignLyrics = useProjectStore((state) => state.realignLyrics);
  const clearLyrics = useProjectStore((state) => state.clearLyrics);

  const currentTime = usePlaybackStore((state) => state.time);
  const setTime = usePlaybackStore((state) => state.setTime);

  const { lyrics } = project;

  /**
   * Au moins une ligne porte-t-elle des mots horodates ?
   *
   * Determine la precision reelle du surlignage: mesure (Whisper) ou balayage
   * deduit de la duree. On le dit a l'utilisateur plutot que de le laisser
   * prendre un balayage regulier pour un calage rate.
   */
  const hasWordTimings = (lyrics?.lines ?? []).some(
    (line) => (line.words?.length ?? 0) > 0,
  );

  // Zone de saisie locale: on ne recalcule le calage qu'a la validation, pas a
  // chaque frappe — sinon chaque caractere creerait une entree d'historique.
  const [draft, setDraft] = useState('');
  const [startAtPlayhead, setStartAtPlayhead] = useState(false);

  const activeIndex = lyrics ? activeLyricIndex(lyrics.lines, currentTime) : -1;

  const handleApply = () => {
    setLyricsFromText(draft, { startAt: startAtPlayhead ? currentTime : 0 });
    setDraft('');
  };

  return (
    <section className="space-y-4 border-t border-ink-700 pt-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
        {t('editor:lyrics.title')}
      </h3>

      {/* Les trois autres entrees viennent AVANT la zone de saisie: l'utilisateur
          qui possede un fichier .lrc doit le voir sans avoir a deviner. */}
      <LyricsSources />

      <p className="rounded-xl border border-ink-600 bg-ink-850/50 p-3 text-xs leading-relaxed text-ink-400">
        {t('editor:lyrics.aiNote')}
      </p>

      {!project.beatMap && (
        <p className="text-xs leading-relaxed text-ink-500">
          {t('editor:lyrics.noBeatMap')}
        </p>
      )}

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-400">
          {t('editor:lyrics.paste')}
        </span>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={4}
          placeholder={t('editor:lyrics.placeholder')}
          className="w-full resize-none rounded-xl border border-ink-600 bg-ink-850 p-3 text-sm text-ink-50 outline-none placeholder:text-ink-400 focus:border-beat-400"
        />
      </label>

      <label className="flex items-center justify-between gap-3 rounded-xl border border-ink-600 bg-ink-850 p-3">
        <span className="text-sm text-ink-200">{t('editor:lyrics.startAt')}</span>
        <input
          type="checkbox"
          checked={startAtPlayhead}
          onChange={(event) => setStartAtPlayhead(event.target.checked)}
          className="size-5 accent-[var(--color-beat-400)]"
        />
      </label>

      <button
        type="button"
        onClick={handleApply}
        disabled={draft.trim().length === 0}
        className="min-h-12 w-full rounded-xl bg-beat-400 text-sm font-semibold text-ink-950 active:bg-beat-500 disabled:opacity-60"
      >
        {t('editor:lyrics.apply')}
      </button>

      {lyrics && lyrics.lines.length > 0 ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-400">
              {t('editor:lyrics.lineCount', { count: lyrics.lines.length })}
            </span>
            <button
              type="button"
              onClick={clearLyrics}
              className="min-h-9 rounded-lg px-2 text-xs font-medium text-danger-500 active:bg-ink-850"
            >
              {t('editor:lyrics.clear')}
            </button>
          </div>

          <Slider
            label={t('editor:lyrics.beatsPerLine')}
            value={lyrics.beatsPerLine}
            min={1}
            max={8}
            step={1}
            onChange={(beatsPerLine) => updateLyrics({ beatsPerLine })}
          />

          <button
            type="button"
            onClick={() => realignLyrics({ startAt: startAtPlayhead ? currentTime : 0 })}
            className="min-h-11 w-full surface rounded-xl border border-ink-600 bg-ink-850 text-sm font-medium text-ink-200 active:bg-ink-800"
          >
            {t('editor:lyrics.realign')}
          </button>

          {/* --- Style commun --- */}
          <div>
            <span className="mb-1.5 block text-xs font-medium text-ink-400">
              {t('editor:text.font')}
            </span>
            <div className="grid grid-cols-5 gap-1.5">
              {FONT_CHOICES.map((font) => (
                <button
                  key={font}
                  type="button"
                  onClick={() => setLyricsFont(font)}
                  aria-pressed={lyrics.style.font === font}
                  style={{ fontFamily: FONT_STACKS[font] }}
                  className={[
                    'min-h-11 rounded-lg border px-1 text-[11px]',
                    lyrics.style.font === font
                      ? 'border-beat-400 text-beat-400'
                      : 'border-ink-600 text-ink-200 active:bg-ink-800',
                  ].join(' ')}
                >
                  {t(`editor:text.fontName.${font}`)}
                </button>
              ))}
            </div>
          </div>

          <Slider
            label={t('editor:text.size')}
            value={lyrics.style.fontSize}
            min={0.03}
            max={0.14}
            step={0.005}
            onChange={(fontSize) =>
              updateLyrics({ style: { ...lyrics.style, fontSize } })
            }
          />
          <Slider
            label={t('editor:lyrics.position')}
            value={lyrics.y}
            min={0.08}
            max={0.92}
            step={0.01}
            onChange={(y) => updateLyrics({ y })}
          />

          {/* --- Karaoke --- */}
          <label className="flex items-center justify-between gap-3 rounded-xl border border-ink-600 bg-ink-850 p-3">
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-ink-200">
                {t('editor:lyrics.karaoke')}
              </span>
              {/* On dit d'ou vient la precision: mesuree ou deduite. Sans cela,
                  un balayage regulier passerait pour un calage rate. */}
              <span className="block text-[11px] leading-relaxed text-ink-400">
                {hasWordTimings
                  ? t('editor:lyrics.karaokeWords')
                  : t('editor:lyrics.karaokeSweep')}
              </span>
            </span>
            <input
              type="checkbox"
              checked={lyrics.karaoke?.enabled ?? false}
              onChange={(event) =>
                updateLyrics({
                  karaoke: {
                    enabled: event.target.checked,
                    color: lyrics.karaoke?.color ?? KARAOKE_SUNG_COLOR,
                  },
                })
              }
              className="size-5 shrink-0 accent-[var(--color-beat-400)]"
            />
          </label>

          {lyrics.karaoke?.enabled === true && (
            <div>
              <span className="mb-1.5 block text-xs font-medium text-ink-400">
                {t('editor:lyrics.karaokeColor')}
              </span>
              <div className="flex items-center gap-2">
                {KARAOKE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() =>
                      updateLyrics({ karaoke: { enabled: true, color } })
                    }
                    aria-label={color}
                    aria-pressed={lyrics.karaoke?.color === color}
                    className={[
                      'size-11 rounded-full border-2',
                      lyrics.karaoke?.color === color
                        ? 'border-ink-50'
                        : 'border-ink-600',
                    ].join(' ')}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* --- Lignes --- */}
          <ul className="space-y-1.5">
            {lyrics.lines.map((line, index) => (
              <li key={line.id} className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => setTime(line.start)}
                  aria-label={t('editor:lyrics.line', { index: index + 1 })}
                  className={[
                    'tnum min-h-11 w-14 shrink-0 rounded-lg border text-[11px]',
                    index === activeIndex
                      ? 'border-beat-400 text-beat-400'
                      : 'border-ink-600 bg-ink-850 text-ink-300 active:bg-ink-800',
                  ].join(' ')}
                >
                  {formatDuration(line.start, i18n.language)}
                </button>

                <input
                  type="text"
                  value={line.text}
                  onChange={(event) =>
                    updateLyricLine(line.id, { text: event.target.value })
                  }
                  aria-label={t('editor:lyrics.line', { index: index + 1 })}
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-850 bg-ink-850 px-2 text-sm text-ink-50 outline-none focus:border-beat-400"
                />

                <button
                  type="button"
                  onClick={() => removeLyricLine(line.id)}
                  aria-label={t('editor:lyrics.removeLine')}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-400 active:bg-ink-800 [&>svg]:size-4"
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-center text-sm text-ink-400">{t('editor:lyrics.empty')}</p>
      )}
    </section>
  );
}
