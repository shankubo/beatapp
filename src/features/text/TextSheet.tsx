/**
 * Panneau Texte: ajout et style des incrustations.
 */

import { useTranslation } from 'react-i18next';

import { useProjectStore } from '../../store/useProjectStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { Segmented } from '../../components/ui/Segmented';
import { Slider } from '../../components/ui/Slider';
import { PlusIcon, TrashIcon } from '../../components/ui/icons';
import { LyricsEditor } from './LyricsEditor';
import { TextMaskEditor } from './TextMaskEditor';
import {
  FONT_CHOICES,
  FONT_STACKS,
  type FilterPreset,
  type TextAnim,
  type TextOverlay,
  type TextPreset,
} from '../../domain/types';
import { filterForPreset } from '../../domain/project';
import { formatDuration } from '../../lib/format';

/*
  Looks proposes sur un texte.

  Les memes que les clips, moins `vhs` — son flou et son decalage de teinte
  rendent un texte illisible bien avant d'etre decoratifs. `custom` est exclu
  pour la meme raison que cote clips: c'est un etat, pas un choix.
*/
const TEXT_FILTER_PRESETS: readonly FilterPreset[] = [
  'none',
  'vivid',
  'faded',
  'mono',
  'warm',
  'cool',
  'noir',
];

const PRESETS: readonly TextPreset[] = ['caption', 'plain', 'karaoke', 'sticker', 'neon'];
const ANIMS: readonly TextAnim[] = ['fade', 'popIn', 'slideUp', 'typewriter', 'none'];

/** Palette restreinte: cinq teintes qui fonctionnent sur n'importe quelle image. */
const COLORS = ['#ffffff', '#0d0e0c', '#e8ff3a', '#ff5c38', '#4cc9f0'] as const;

/**
 * Emoji proposes.
 *
 * Une courte selection plutot qu'un clavier complet: le clavier systeme du
 * telephone en offre deja un, et ces boutons servent aux insertions rapides
 * pendant qu'on regle le style. Le rendu canvas les dessine avec `fillText`,
 * comme n'importe quel caractere.
 */
const EMOJIS = ['🔥', '✨', '❤️', '😂', '🎵', '💯', '👀', '🙌', '⚡', '🌊'] as const;

export function TextSheet() {
  const { t, i18n } = useTranslation(['editor', 'common']);

  const project = useProjectStore((state) => state.project);
  const addText = useProjectStore((state) => state.addText);
  const updateText = useProjectStore((state) => state.updateText);
  const setTextPreset = useProjectStore((state) => state.setTextPreset);
  const setTextFont = useProjectStore((state) => state.setTextFont);
  const removeText = useProjectStore((state) => state.removeText);

  const selectedId = usePlaybackStore((state) => state.selectedOverlayId);
  const selectOverlay = usePlaybackStore((state) => state.selectOverlay);
  const setTime = usePlaybackStore((state) => state.setTime);
  const currentTime = usePlaybackStore((state) => state.time);

  const overlay = project.overlays.find((candidate) => candidate.id === selectedId);

  /*
    Raccourcis vers les effets du texte selectionne.

    Nommes ici plutot que relus a chaque usage: chacun sert au moins trois fois
    dans la section Effets (case a cocher, couleur, curseurs), et `overlay` peut
    etre absent — les extraire une fois evite d'eparpiller autant de `?.`.
  */
  const glow = overlay?.style.glow;
  const gradient = overlay?.style.gradient;
  const stroke = overlay?.style.stroke;
  const shadow = overlay?.style.shadow;

  /** Applique un patch de style au texte selectionne. */
  const updateStyle = (patch: Partial<TextOverlay['style']>) => {
    if (!overlay) return;
    updateText(overlay.id, { style: { ...overlay.style, ...patch } });
  };

  /**
   * Amene la tete de lecture LA OU le texte est pleinement visible.
   *
   * Indispensable: un texte pose a `currentTime` commence exactement sous la
   * tete de lecture, donc a `progressIn = 0`. L'animation d'entree le rend
   * alors totalement transparent et `drawTextLayer` l'ecarte — l'utilisateur
   * ajoutait un texte et ne voyait rien apparaitre. On se place juste apres
   * l'animation d'entree.
   */
  const revealAt = (candidate: TextOverlay) => {
    const animation = Math.min(candidate.animation.duration, candidate.duration / 2);
    const visibleAt = candidate.start + animation;
    const time = usePlaybackStore.getState().time;
    // Deja dans la zone pleinement visible: on ne deplace pas la tete de
    // lecture sous les doigts de l'utilisateur.
    const end = candidate.start + candidate.duration;
    if (time >= visibleAt && time < end) return;
    setTime(Math.min(visibleAt, end));
  };

  const handleAdd = () => {
    // Le texte apparait a la position de lecture: c'est ce que l'utilisateur
    // regarde au moment ou il appuie.
    const id = addText(t('editor:text.placeholder'), { start: currentTime });
    selectOverlay(id);
    // Le texte est cree exactement a `currentTime`: sans ce saut il resterait
    // invisible (voir `revealAt`).
    const created = useProjectStore
      .getState()
      .project.overlays.find((candidate) => candidate.id === id);
    if (created) revealAt(created);
  };

  /** Selectionner un texte amene aussi la lecture dessus: on edite ce qu'on voit. */
  const handleSelect = (candidate: TextOverlay) => {
    selectOverlay(candidate.id);
    revealAt(candidate);
  };

  return (
    <div className="space-y-4 pt-1">
      <button
        type="button"
        onClick={handleAdd}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink-800 px-3 text-sm font-medium text-ink-50 active:bg-ink-700 [&>svg]:size-4"
      >
        <PlusIcon />
        {t('editor:text.add')}
      </button>

      {project.overlays.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-400">{t('editor:text.empty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {project.overlays.map((candidate) => (
            <li key={candidate.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSelect(candidate)}
                className={[
                  'min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-left',
                  candidate.id === selectedId
                    ? 'border-beat-400 bg-ink-850'
                    : 'border-ink-600 bg-ink-850 active:bg-ink-800',
                ].join(' ')}
              >
                <span className="block truncate text-sm text-ink-50">
                  {/* Le texte de l'utilisateur est rendu comme du TEXTE, jamais
                      interprete: React echappe, et le rendu canvas utilise
                      fillText. */}
                  {candidate.text || t('editor:text.placeholder')}
                </span>
                <span className="tnum block text-xs text-ink-400">
                  {formatDuration(candidate.start, i18n.language)}
                </span>
              </button>

              {/*
                Deux suppressions, comme pour l'image et le son: refermer le
                vide, ou le laisser. Le choix se fait au moment de detruire.
              */}
              <button
                type="button"
                onClick={() => removeText(candidate.id, { leaveGap: true })}
                aria-label={t('editor:text.removeLeaveGap')}
                className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-400 active:bg-ink-800 [&>svg]:size-4"
              >
                <TrashIcon />
              </button>
              <button
                type="button"
                onClick={() => removeText(candidate.id, { leaveGap: false })}
                aria-label={t('editor:text.removeClose')}
                className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-ink-600 text-[10px] font-medium text-ink-400 active:bg-ink-800"
              >
                {t('editor:text.closeShort')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {overlay && (
        <section className="space-y-4 border-t border-ink-700 pt-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-400">
              {t('editor:text.content')}
            </span>
            <textarea
              value={overlay.text}
              onChange={(event) => updateText(overlay.id, { text: event.target.value })}
              rows={2}
              className="w-full resize-none rounded-xl border border-ink-600 bg-ink-850 p-3 text-sm text-ink-50 outline-none focus:border-beat-400"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-ink-400">
              {t('editor:text.style')}
            </span>
            <Segmented
              label={t('editor:text.style')}
              options={PRESETS.map((preset) => ({
                value: preset,
                label: t(`editor:text.preset.${preset}`),
              }))}
              value={overlay.style.preset ?? 'caption'}
              onChange={(preset) => setTextPreset(overlay.id, preset)}
            />
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-ink-400">
              {t('editor:text.font')}
            </span>
            <div className="grid grid-cols-5 gap-1.5">
              {FONT_CHOICES.map((font) => (
                <button
                  key={font}
                  type="button"
                  onClick={() => setTextFont(overlay.id, font)}
                  aria-pressed={overlay.style.font === font}
                  // La vignette est rendue DANS la police concernee: c'est le
                  // seul apercu qui renseigne vraiment.
                  style={{ fontFamily: FONT_STACKS[font] }}
                  className={[
                    'min-h-11 rounded-lg border px-1 text-[11px]',
                    overlay.style.font === font
                      ? 'border-beat-400 text-beat-400'
                      : 'border-ink-600 text-ink-200 active:bg-ink-800',
                  ].join(' ')}
                >
                  {t(`editor:text.fontName.${font}`)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-ink-400">
              {t('editor:text.color')}
            </span>
            <div className="flex items-center gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() =>
                    updateText(overlay.id, { style: { ...overlay.style, color } })
                  }
                  aria-label={color}
                  aria-pressed={overlay.style.color === color}
                  className={[
                    'size-11 rounded-full border-2',
                    overlay.style.color === color ? 'border-beat-400' : 'border-ink-600',
                  ].join(' ')}
                  style={{ backgroundColor: color }}
                />
              ))}

              {/* Choix libre: le selecteur natif est la seule roue chromatique
                  utilisable au doigt sans en reecrire une. */}
              <label className="relative size-11 shrink-0 overflow-hidden rounded-full border-2 border-ink-600">
                <span className="sr-only">{t('editor:text.customColor')}</span>
                <input
                  type="color"
                  value={overlay.style.color}
                  onChange={(event) =>
                    updateText(overlay.id, {
                      style: { ...overlay.style, color: event.target.value },
                    })
                  }
                  // Le champ natif est agrandi et decale pour que sa pastille
                  // remplisse la pastille ronde.
                  className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0"
                />
              </label>
            </div>
          </div>

          <Slider
            label={t('editor:text.size')}
            value={overlay.style.fontSize}
            min={0.03}
            /*
              0,45 et non 0,16: l'ancien plafond bridait a 16 % de la largeur,
              soit ~62 px sur une frame 390 — bien trop peu pour un titre qui
              occupe l'ecran. Le retour a la ligne automatique borne de toute
              facon la casse, et `maxWidth` reste la vraie limite de la boite.
            */
            max={0.45}
            step={0.005}
            onChange={(fontSize) =>
              updateText(overlay.id, { style: { ...overlay.style, fontSize } })
            }
          />

          <Slider
            label={t('editor:text.weight')}
            value={overlay.style.fontWeight}
            min={400}
            max={900}
            step={100}
            onChange={(fontWeight) =>
              updateText(overlay.id, { style: { ...overlay.style, fontWeight } })
            }
          />

          <div>
            <span className="mb-1.5 block text-xs font-medium text-ink-400">
              {t('editor:text.align')}
            </span>
            <Segmented
              label={t('editor:text.align')}
              options={[
                { value: 'left', label: t('editor:text.alignLeft') },
                { value: 'center', label: t('editor:text.alignCenter') },
                { value: 'right', label: t('editor:text.alignRight') },
              ]}
              value={overlay.style.align}
              onChange={(align) =>
                updateText(overlay.id, { style: { ...overlay.style, align } })
              }
            />
          </div>

          {/* --- Position --- */}
          <Slider
            label={t('editor:text.positionX')}
            value={overlay.x}
            min={0.1}
            max={0.9}
            step={0.01}
            onChange={(x) => updateText(overlay.id, { x })}
          />
          <Slider
            label={t('editor:text.positionY')}
            value={overlay.y}
            min={0.08}
            max={0.92}
            step={0.01}
            onChange={(y) => updateText(overlay.id, { y })}
          />
          <Slider
            label={t('editor:text.width')}
            value={overlay.maxWidth}
            min={0.3}
            max={0.95}
            step={0.05}
            onChange={(maxWidth) => updateText(overlay.id, { maxWidth })}
          />
          <Slider
            label={t('editor:text.rotation')}
            value={overlay.rotation}
            min={-0.35}
            max={0.35}
            step={0.01}
            onChange={(rotation) => updateText(overlay.id, { rotation })}
          />

          {/*
            Effets, REPLIES par defaut.

            Six reglages de plus deplies en permanence auraient noye les
            reglages courants — taille, couleur, position — qu'on touche a
            chaque texte. Replies, ils restent a un tap pour qui les cherche.
          */}
          <details className="rounded-xl border border-ink-700">
            <summary className="min-h-11 cursor-pointer list-none px-3 py-3 text-xs font-medium uppercase tracking-wide text-ink-400">
              {t('editor:text.effects')}
            </summary>

            <div className="space-y-4 border-t border-ink-700 p-3">
              {/* --- Lueur --- */}
              <div className="space-y-2">
                <label className="flex min-h-11 items-center justify-between gap-3">
                  <span className="text-sm text-ink-200">{t('editor:text.glow')}</span>
                  <input
                    type="checkbox"
                    checked={glow !== undefined}
                    onChange={(event) =>
                      updateStyle({
                        // Valeurs de depart FRANCHES: un effet pose a peine
                        // visible se lit comme un reglage qui ne marche pas.
                        glow: event.target.checked
                          ? { color: '#ffd166', radius: 0.03, intensity: 0.9 }
                          : undefined,
                      })
                    }
                    className="size-5 accent-[var(--color-beat-400)]"
                  />
                </label>

                {glow && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-400">{t('editor:text.glowColor')}</span>
                      <label className="relative size-11 shrink-0 overflow-hidden rounded-full border-2 border-ink-600">
                        <span className="sr-only">{t('editor:text.glowColor')}</span>
                        <input
                          type="color"
                          value={glow.color}
                          onChange={(event) =>
                            updateStyle({ glow: { ...glow, color: event.target.value } })
                          }
                          className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0"
                        />
                      </label>
                    </div>
                    <Slider
                      label={t('editor:text.glowRadius')}
                      value={glow.radius}
                      min={0.005}
                      max={0.08}
                      step={0.005}
                      onChange={(radius) => updateStyle({ glow: { ...glow, radius } })}
                    />
                    <Slider
                      label={t('editor:text.glowIntensity')}
                      value={glow.intensity}
                      min={0.1}
                      max={1}
                      step={0.05}
                      onChange={(intensity) => updateStyle({ glow: { ...glow, intensity } })}
                    />
                  </>
                )}
              </div>

              {/* --- Degrade --- */}
              <div className="space-y-2 border-t border-ink-700 pt-3">
                <label className="flex min-h-11 items-center justify-between gap-3">
                  <span className="text-sm text-ink-200">{t('editor:text.gradient')}</span>
                  <input
                    type="checkbox"
                    checked={gradient !== undefined}
                    onChange={(event) =>
                      updateStyle({
                        gradient: event.target.checked
                          ? { from: '#ff8ba7', to: '#7cc6ff', angle: 0 }
                          : undefined,
                      })
                    }
                    className="size-5 accent-[var(--color-beat-400)]"
                  />
                </label>

                {gradient && (
                  <>
                    <div className="flex items-center gap-3">
                      {(['from', 'to'] as const).map((end) => (
                        <label
                          key={end}
                          className="relative size-11 shrink-0 overflow-hidden rounded-full border-2 border-ink-600"
                        >
                          <span className="sr-only">{t(`editor:text.gradient_${end}`)}</span>
                          <input
                            type="color"
                            value={gradient[end]}
                            onChange={(event) =>
                              updateStyle({ gradient: { ...gradient, [end]: event.target.value } })
                            }
                            className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0"
                          />
                        </label>
                      ))}
                    </div>
                    <Slider
                      label={t('editor:text.gradientAngle')}
                      value={gradient.angle}
                      min={0}
                      max={Math.PI}
                      step={0.05}
                      onChange={(angle) => updateStyle({ gradient: { ...gradient, angle } })}
                    />
                  </>
                )}
              </div>

              {/* --- Contour --- */}
              <div className="space-y-2 border-t border-ink-700 pt-3">
                <label className="flex min-h-11 items-center justify-between gap-3">
                  <span className="text-sm text-ink-200">{t('editor:text.stroke')}</span>
                  <input
                    type="checkbox"
                    checked={stroke !== undefined}
                    onChange={(event) =>
                      updateStyle({
                        stroke: event.target.checked
                          ? { color: '#000000', width: 0.14 }
                          : undefined,
                      })
                    }
                    className="size-5 accent-[var(--color-beat-400)]"
                  />
                </label>

                {stroke && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-400">{t('editor:text.strokeColor')}</span>
                      <label className="relative size-11 shrink-0 overflow-hidden rounded-full border-2 border-ink-600">
                        <span className="sr-only">{t('editor:text.strokeColor')}</span>
                        <input
                          type="color"
                          value={stroke.color}
                          onChange={(event) =>
                            updateStyle({ stroke: { ...stroke, color: event.target.value } })
                          }
                          className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0"
                        />
                      </label>
                    </div>
                    <Slider
                      label={t('editor:text.strokeWidth')}
                      value={stroke.width}
                      min={0.02}
                      max={0.4}
                      step={0.02}
                      onChange={(width) => updateStyle({ stroke: { ...stroke, width } })}
                    />
                  </>
                )}
              </div>

              {/* --- Ombre portee --- */}
              <div className="space-y-2 border-t border-ink-700 pt-3">
                <label className="flex min-h-11 items-center justify-between gap-3">
                  <span className="text-sm text-ink-200">{t('editor:text.shadow')}</span>
                  <input
                    type="checkbox"
                    checked={shadow !== undefined}
                    onChange={(event) =>
                      updateStyle({
                        shadow: event.target.checked
                          ? { color: '#000000', blur: 0.012, x: 0.004, y: 0.006 }
                          : undefined,
                      })
                    }
                    className="size-5 accent-[var(--color-beat-400)]"
                  />
                </label>

                {shadow && (
                  <Slider
                    label={t('editor:text.shadowBlur')}
                    value={shadow.blur}
                    min={0}
                    max={0.05}
                    step={0.002}
                    onChange={(blur) => updateStyle({ shadow: { ...shadow, blur } })}
                  />
                )}
              </div>

              {/* --- Filtre colorimetrique --- */}
              <div className="space-y-2 border-t border-ink-700 pt-3">
                <span className="block text-xs font-medium text-ink-400">
                  {t('editor:text.filter')}
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {TEXT_FILTER_PRESETS.map((preset) => {
                    const active = (overlay.filter?.preset ?? 'none') === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() =>
                          updateText(overlay.id, {
                            filter:
                              preset === 'none'
                                ? undefined
                                : { ...filterForPreset(preset), intensity: 1 },
                          })
                        }
                        aria-pressed={active}
                        className={[
                          'min-h-11 rounded-lg border px-1 text-xs font-medium',
                          active
                            ? 'border-beat-400 text-beat-400'
                            : 'border-ink-600 text-ink-200 active:bg-ink-800',
                        ].join(' ')}
                      >
                        {t(`editor:clip.filterPreset.${preset}`)}
                      </button>
                    );
                  })}
                </div>

                {overlay.filter && (
                  <Slider
                    label={t('editor:clip.filterIntensity')}
                    value={overlay.filter.intensity}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(intensity) =>
                      updateText(overlay.id, {
                        filter: { ...overlay.filter!, intensity },
                      })
                    }
                  />
                )}
              </div>
            </div>
          </details>

          {/* --- Emoji --- */}
          <div>
            <span className="mb-1.5 block text-xs font-medium text-ink-400">
              {t('editor:text.emoji')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() =>
                    updateText(overlay.id, { text: `${overlay.text}${emoji}` })
                  }
                  aria-label={t('editor:text.insertEmoji')}
                  className="size-11 rounded-lg border border-ink-600 text-lg active:bg-ink-800"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <Slider
            label={t('editor:text.timing')}
            value={overlay.duration}
            min={0.5}
            max={15}
            step={0.1}
            onChange={(duration) => updateText(overlay.id, { duration })}
            displayValue={formatDuration(overlay.duration, i18n.language)}
          />

          <div>
            <span className="mb-1.5 block text-xs font-medium text-ink-400">
              {t('editor:text.animationIn')}
            </span>
            <Segmented
              label={t('editor:text.animationIn')}
              options={ANIMS.map((anim) => ({
                value: anim,
                label: t(`editor:text.anim.${anim}`),
              }))}
              value={overlay.animation.in}
              onChange={(value) =>
                updateText(overlay.id, { animation: { ...overlay.animation, in: value } })
              }
            />
          </div>

          <label className="flex items-center justify-between gap-3 rounded-xl border border-ink-600 bg-ink-850 p-3">
            <span className="text-sm text-ink-200">{t('editor:text.beatPulse')}</span>
            <input
              type="checkbox"
              checked={overlay.beatPulse?.enabled ?? false}
              onChange={(event) =>
                updateText(overlay.id, {
                  beatPulse: { enabled: event.target.checked, amount: 0.12 },
                })
              }
              // Sans analyse rythmique, la pulsation n'a rien sur quoi se caler.
              disabled={!project.beatMap}
              className="size-5 accent-[var(--color-beat-400)] disabled:opacity-60"
            />
          </label>
        </section>
      )}

      {/* Les paroles sont dans l'onglet Texte plutot que dans un onglet a part:
          c'est du texte, et un septieme onglet ne tiendrait pas sur 390 px. */}
      {/*
        Le masque vient APRES les incrustations et avant les paroles.

        Apres, parce qu'il est plus rare qu'un texte ordinaire et ne doit pas
        s'interposer dans le geste courant. Avant les paroles, qui forment le
        bloc le plus long du panneau.
      */}
      <TextMaskEditor />

      <LyricsEditor />
    </div>
  );
}
