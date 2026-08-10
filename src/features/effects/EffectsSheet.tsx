/**
 * Panneau Effets: transitions, cadrage, zoom lent, filtres.
 * Agit sur le clip selectionne, ou sur tous les clips a la fois.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectStore } from '../../store/useProjectStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { Segmented } from '../../components/ui/Segmented';
import { Slider } from '../../components/ui/Slider';
import {
  clipIndexAt,
  maxTransitionDuration,
  uniformTransitionLimit,
} from '../../domain/timeline';
import {
  filterForPreset,
  neutralFilter,
  getKenBurnsPreset,
  KEN_BURNS_PRESETS,
  KEN_BURNS_KEYS,
} from '../../domain/project';
import {
  directionsFor,
  familyOf,
  isDirectional,
  transitionTypeFor,
  type TransitionDirection,
  type TransitionFamily,
} from '../../domain/transitionFamily';
import {
  TRANSITION_ACCENTS,
  type Clip,
  type ClipFilter,
  type FilterPreset,
  type TransitionAccent,
} from '../../domain/types';
import { formatDuration, formatPercent } from '../../lib/format';

/*
  Ordre de la grille: du plus sobre au plus marque.

  `none` et `fade` en tete parce que ce sont les choix par defaut d'un montage
  ordinaire; les effets spectaculaires (obturateur, glitch, tremblement) en fin
  de liste. Un utilisateur qui parcourt la grille rencontre ainsi le discret
  avant le demonstratif.

  La grille liste des FAMILLES et non des types: `slide` compte quatre sens et
  `paperSlide` autant, ce qui faisait vingt boutons dont douze ne differaient que
  par une fleche. Le sens se choisit dans une seconde rangee, sous la grille —
  voir `domain/transitionFamily.ts` pour la traduction famille+sens -> type.
*/
const TRANSITION_FAMILIES: readonly TransitionFamily[] = [
  'none',
  'fade',
  'blurFade',
  'slide',
  // Poussee juste apres les glissements: meme geometrie, rythme different.
  // Les separer les rendrait difficiles a comparer.
  'push',
  'wipeLeft',
  // Meme geste de decouverte que le balayage, mais le bord est ici un calque
  // visible et non une simple limite de decoupe.
  'paperSlide',
  'zoomIn',
  'iris',
  'shutter',
  'whipPan',
  'shake',
  'glitch',
  'flash',
];

/*
  Fleches des sens. Ce sont des SYMBOLES et non du texte a traduire: une fleche
  se lit dans toutes les langues, et le libellé lisible passe par `aria-label`.
*/
const DIRECTION_GLYPHS: Record<TransitionDirection, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
};

/** `custom` n'est pas propose: c'est un etat, pas un choix. */
const FILTER_PRESETS: readonly FilterPreset[] = [
  'none',
  'vivid',
  'faded',
  'mono',
  'warm',
  'cool',
  'noir',
  'vhs',
];

const DEFAULT_TRANSITION_DURATION = 0.3;

/**
 * Portee d'un reglage d'effet: ce plan, ou tout le montage.
 *
 * Etat LOCAL et non dans un store: c'est une intention de geste, pas un reglage.
 * La ranger dans `useUiStore` la ferait survivre a la fermeture du panneau, et
 * on reviendrait des jours plus tard sur « tous les clips » sans s'en souvenir —
 * un mode global silencieux est exactement ce qu'il faut eviter ici.
 *
 * Elle repart donc a `clip` a chaque ouverture: le choix le moins destructeur.
 */
type EffectScope = 'clip' | 'all';

export function EffectsSheet() {
  const { t, i18n } = useTranslation(['editor', 'common']);
  const [scope, setScope] = useState<EffectScope>('clip');
  /*
    Dernier sens choisi, garde en LOCAL.

    Il sert quand la transition courante n'en porte pas: passer de « Fondu » a
    « Glisse » doit reprendre le sens qu'on venait d'utiliser plutot que de
    repartir systematiquement vers la gauche. Ce n'est pas un reglage de projet
    — rien a enregistrer, rien a annuler — donc il n'a sa place ni dans
    `useProjectStore` ni dans les preferences.
  */
  const [preferredDirection, setPreferredDirection] = useState<TransitionDirection>('left');

  const project = useProjectStore((state) => state.project);
  const updateClip = useProjectStore((state) => state.updateClip);
  const setTransition = useProjectStore((state) => state.setTransition);
  const setTransitionForAll = useProjectStore((state) => state.setTransitionForAll);
  const setClipFilter = useProjectStore((state) => state.setClipFilter);
  const setFilterPreset = useProjectStore((state) => state.setFilterPreset);
  const setFilterForAll = useProjectStore((state) => state.setFilterForAll);

  const selectedId = usePlaybackStore((state) => state.selectedClipId);
  const currentTime = usePlaybackStore((state) => state.time);

  const clips = project.videoTrack.clips;
  const selectedIndex = clips.findIndex((clip) => clip.id === selectedId);

  /**
   * A defaut de selection, on agit sur le clip visible a la position de lecture.
   *
   * C'est celui que l'utilisateur regarde: lui presenter un panneau vide alors
   * qu'une image est a l'ecran serait deroutant.
   */
  const index = selectedIndex >= 0 ? selectedIndex : clipIndexAt(project.videoTrack, currentTime);
  const clip = index >= 0 ? clips[index] : undefined;

  if (!clip) {
    return (
      <p className="py-6 text-center text-sm text-ink-400">
        {t('editor:media.emptyHint')}
      </p>
    );
  }

  const transitionType = clip.transitionIn?.type ?? 'none';
  /*
    La famille allumee est DERIVEE du projet, jamais tenue en etat local: elle
    doit suivre la selection de clip. Seul le sens a besoin d'une memoire propre
    — voir `preferredDirection`.
  */
  const active = familyOf(transitionType);
  const activeFamily = active.family;
  // Le sens memorise ne vaut que tant qu'il n'a pas ete remplace par celui du
  // clip courant: c'est ce dernier qui fait foi des qu'il en porte un.
  const activeDirection = isDirectional(activeFamily) ? active.direction : preferredDirection;
  const directions = directionsFor(activeFamily);
  const activeAccent = clip.transitionIn?.accent;
  const maxDuration = maxTransitionDuration(clips, index);

  // Borne du curseur de duree, selon la portee. En global, c'est le plan le plus
  // court qui commande — sinon la valeur affichee ne serait pas celle appliquee.
  const shortestMaxDuration = uniformTransitionLimit(clips);
  const durationLimit = scope === 'all' ? shortestMaxDuration : maxDuration;
  const filter = clip.filter ?? neutralFilter();
  const activePreset = clip.filter?.preset ?? 'none';
  const kenBurnsOn = clip.kenBurns !== undefined;

  /**
   * Reglage manuel d'une composante.
   *
   * Le look passe a `custom`: sans cela, la vignette du preset resterait
   * allumee alors que les valeurs ne correspondent plus, et le recharger
   * ecraserait silencieusement le reglage.
   */
  const setCustomFilter = (patch: Partial<ClipFilter>) => {
    const next: ClipFilter = { ...filter, ...patch, preset: 'custom' };
    if (scope === 'all') setFilterForAll(next);
    else setClipFilter(clip.id, next);
  };

  /*
    Les gestionnaires ci-dessous aiguillent tous sur la portee.

    Chacun choisit entre l'action « ce clip » et l'action « tout le montage »,
    qui existaient deja: la portee ne fait que decider laquelle appeler, sans
    dupliquer la moindre logique de mutation.
  */
  /**
   * Applique une famille, en conservant le sens courant.
   *
   * `transitionTypeFor` retombe sur le premier sens disponible quand la famille
   * ne connait pas celui demande — sans quoi choisir « Poussee » alors que le
   * sens courant est « haut » fabriquerait un `pushUp` inexistant.
   */
  const applyFamily = (family: TransitionFamily) => {
    if (family === 'none') {
      if (scope === 'all') setTransitionForAll(undefined);
      else setTransition(clip.id, undefined);
      return;
    }

    const transition = {
      type: transitionTypeFor(family, activeDirection),
      duration: Math.min(
        clip.transitionIn?.duration ?? DEFAULT_TRANSITION_DURATION,
        // En portee globale, la duree est bornee par le plan le plus court du
        // montage: une transition plus longue que son clip serait tronquee.
        Math.max(scope === 'all' ? shortestMaxDuration : maxDuration, 0.05),
      ),
      /*
        L'accent SURVIT au changement d'effet: on essaie des transitions en
        gardant son tremblement, et le perdre a chaque clic obligerait a le
        reposer sans arret.

        Sauf s'il devient le doublon de la transition choisie — « Tremblement »
        accentue par « Tremblement » doublerait l'amplitude sans rien ajouter.
        Le bouton correspondant est grise, mais on peut arriver ici par l'autre
        chemin: poser l'accent d'abord, puis choisir cette famille.
      */
      ...(activeAccent && activeAccent !== family ? { accent: activeAccent } : {}),
    };

    if (scope === 'all') setTransitionForAll(transition);
    else setTransition(clip.id, transition);
  };

  /** Change le sens sans quitter la famille courante, ni perdre l'accent. */
  const applyDirection = (direction: TransitionDirection) => {
    setPreferredDirection(direction);
    if (!isDirectional(activeFamily)) return;

    const duration = clip.transitionIn?.duration ?? DEFAULT_TRANSITION_DURATION;
    const transition = {
      type: transitionTypeFor(activeFamily, direction),
      duration,
      ...(activeAccent ? { accent: activeAccent } : {}),
    };
    if (scope === 'all') setTransitionForAll(transition);
    else setTransition(clip.id, transition);
  };

  /**
   * Pose ou retire l'accent, sans toucher a la transition.
   *
   * Un second appui sur l'accent actif le RETIRE: c'est ce qui evite d'ajouter
   * un bouton « Aucun » a une rangee de trois, et rend le geste reversible la ou
   * on l'a fait.
   */
  const applyAccent = (accent: TransitionAccent) => {
    const current = clip.transitionIn;
    if (!current) return;

    const next = activeAccent === accent ? undefined : accent;
    const transition = {
      type: current.type,
      duration: current.duration,
      ...(next ? { accent: next } : {}),
    };
    if (scope === 'all') setTransitionForAll(transition);
    else setTransition(clip.id, transition);
  };

  const applyTransitionDuration = (duration: number) => {
    const type = clip.transitionIn?.type;
    if (!type) return;
    if (scope === 'all') setTransitionForAll({ type, duration });
    else setTransition(clip.id, { type, duration });
  };

  const applyPreset = (preset: FilterPreset) => {
    if (scope !== 'all') {
      setFilterPreset(clip.id, preset);
      return;
    }
    // `setFilterForAll` prend un filtre complet et non un nom de look: on
    // reutilise l'intensite courante, comme le fait `setFilterPreset`.
    if (preset === 'none') setFilterForAll(undefined);
    else setFilterForAll({ ...filterForPreset(preset), intensity: filter.intensity });
  };

  const applyIntensity = (intensity: number) => {
    const next = { ...filter, intensity };
    if (scope === 'all') setFilterForAll(next);
    else setClipFilter(clip.id, next);
  };

  /*
    Cadrage et zoom lent suivent la portee eux aussi.

    Les en exclure aurait fait mentir le selecteur: pose en tete du panneau, il
    annonce gouverner tout ce qui suit. Deux reglages obeissant et deux autres
    non auraient ete impossibles a deviner.
  */
  const applyToScope = (patch: Partial<Clip>) => {
    if (scope === 'all') clips.forEach((target) => updateClip(target.id, patch));
    else updateClip(clip.id, patch);
  };

  /**
   * Y a-t-il quelque chose a retirer, dans la portee courante ?
   *
   * Sert a masquer le bouton plutot qu'a le griser: un « Tout retirer » propose
   * sur un montage vierge laisse croire qu'un effet traine quelque part.
   */
  const targets = scope === 'all' ? clips : [clip];
  const hasEffects = targets.some(
    (target) => target.transitionIn || target.filter || target.kenBurns,
  );

  /**
   * Remet a zero tout ce que CE panneau sait poser.
   *
   * Volontairement limite aux effets: transition (donc son accent), filtre et
   * zoom lent. Le cadrage `fit` et le recadrage manuel n'en sont pas — ils
   * decrivent comment l'image entre dans le format, pas un effet ajoute, et les
   * effacer deferait un travail de cadrage que l'utilisateur ne pense pas
   * confier a un bouton nomme « retirer les effets ».
   *
   * Une seule entree d'historique par clip: `updateClip` porte les trois champs
   * en un seul patch, si bien qu'un unique « annuler » restaure tout.
   */
  const clearEffects = () => {
    targets.forEach((target) =>
      updateClip(target.id, {
        transitionIn: undefined,
        filter: undefined,
        kenBurns: undefined,
      }),
    );
  };

  return (
    <div className="space-y-5 pt-1">
      {/*
        Portee, EN TETE du panneau et non dans chaque section.

        Elle gouverne tout ce qui suit — transitions comme filtres — donc la
        repeter par section laisserait croire a deux reglages independants. En
        tete, elle se lit comme la question posee avant toute action: « ceci
        s'applique a quoi ? »

        Masquee sur un montage d'un seul plan: proposer « tous les clips » quand
        il n'y en a qu'un serait une distinction sans difference.
      */}
      {clips.length > 1 && (
        <Segmented
          label={t('editor:effects.scope')}
          options={[
            { value: 'clip' as const, label: t('editor:effects.scopeClip') },
            { value: 'all' as const, label: t('editor:effects.scopeAll') },
          ]}
          value={scope}
          onChange={setScope}
        />
      )}

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
          {t('editor:effects.transition')}
        </h3>

        <div className="grid grid-cols-3 gap-2">
          {TRANSITION_FAMILIES.map((family) => (
            <button
              key={family}
              type="button"
              onClick={() => applyFamily(family)}
              aria-pressed={activeFamily === family}
              className={[
                'min-h-11 rounded-lg border px-2 text-xs font-medium',
                activeFamily === family
                  ? 'border-beat-400 text-beat-400'
                  : 'border-ink-600 text-ink-200 active:bg-ink-800',
              ].join(' ')}
            >
              {t(`editor:effects.family.${family}`)}
            </button>
          ))}
        </div>

        {/*
          Rangee de sens, affichee UNIQUEMENT pour les familles qui en proposent.

          Toujours visible mais grisee, elle occuperait de la place et poserait la
          question « pourquoi ne puis-je pas cliquer ? » sur les deux tiers des
          transitions. Affichee a la demande, son apparition dit d'elle-meme que
          l'effet choisi a des variantes.

          Les fleches sont doublees d'un `aria-label` en toutes lettres: seules,
          elles ne se lisent pas a la synthese vocale.
        */}
        {directions.length > 0 && (
          <div className="space-y-1 pt-1">
            <h4 className="text-xs font-medium uppercase tracking-wide text-ink-400">
              {t('editor:effects.direction')}
            </h4>
            <div className="flex gap-2">
              {directions.map((direction) => (
                <button
                  key={direction}
                  type="button"
                  onClick={() => applyDirection(direction)}
                  aria-pressed={activeDirection === direction}
                  aria-label={t(`editor:effects.directionName.${direction}`)}
                  className={[
                    'min-h-11 flex-1 rounded-lg border text-base',
                    activeDirection === direction
                      ? 'border-beat-400 text-beat-400'
                      : 'border-ink-600 text-ink-200 active:bg-ink-800',
                  ].join(' ')}
                >
                  {DIRECTION_GLYPHS[direction]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/*
          Accent CUMULE par-dessus la transition — « Calque + Tremblement ».

          Masque quand il n'y a pas de transition: un accent partage la duree et
          la progression de celle-ci, donc sans elle il n'aurait aucune fenetre
          de temps ou vivre. Proposer les boutons quand meme afficherait un choix
          qui ne peut rien produire.

          Les trois proposes sont ceux dont les canaux ne se disputent rien avec
          une transition — voir `TransitionAccent`.
        */}
        {clip.transitionIn && (
          <div className="space-y-1 pt-1">
            <h4 className="text-xs font-medium uppercase tracking-wide text-ink-400">
              {t('editor:effects.accent')}
            </h4>
            <div className="flex gap-2">
              {TRANSITION_ACCENTS.map((accent) => {
                /*
                  Un accent identique a la transition est GRISE et non masque.

                  Cumuler « Tremblement » avec « Tremblement » doublerait
                  l'amplitude sans rien apporter de lisible. Le masquer ferait
                  sauter la rangee de trois a deux boutons selon l'effet choisi,
                  et les positions changeraient sous le pouce — un bouton grise
                  garde la rangee stable et dit pourquoi il est inactif.
                */
                const redundant = activeFamily === accent;
                return (
                  <button
                    key={accent}
                    type="button"
                    disabled={redundant}
                    onClick={() => applyAccent(accent)}
                    aria-pressed={activeAccent === accent}
                    className={[
                      'min-h-11 flex-1 rounded-lg border px-2 text-xs font-medium',
                      redundant
                        ? 'border-ink-700 text-ink-400 opacity-60'
                        : activeAccent === accent
                          ? 'border-beat-400 text-beat-400'
                          : 'border-ink-600 text-ink-200 active:bg-ink-800',
                    ].join(' ')}
                  >
                    {t(`editor:effects.family.${accent}`)}
                  </button>
                );
              })}
            </div>
            {/* Le geste de retrait n'est pas devinable: on l'annonce. */}
            <p className="text-xs text-ink-400">{t('editor:effects.accentHint')}</p>
          </div>
        )}

        {/* Le premier clip n'a rien avant lui: pas de transition d'entree. */}
        {index === 0 && transitionType !== 'none' && (
          <p className="text-xs text-ink-400">{t('editor:timeline.clip', { index: 1 })}</p>
        )}

        {/*
          La borne du curseur suit la portee: en global, c'est le plan le plus
          court qui commande, sinon la valeur affichee ne serait pas celle
          appliquee partout.
        */}
        {clip.transitionIn && durationLimit > 0 && (
          <Slider
            label={t('editor:effects.transitionDuration')}
            value={Math.min(clip.transitionIn.duration, durationLimit)}
            min={0.05}
            max={durationLimit}
            step={0.05}
            onChange={applyTransitionDuration}
            displayValue={formatDuration(
              Math.min(clip.transitionIn.duration, durationLimit),
              i18n.language,
            )}
          />
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
          {t('editor:clip.fit')}
        </h3>
        <Segmented
          label={t('editor:clip.fit')}
          options={[
            { value: 'cover', label: t('editor:clip.fitCover') },
            { value: 'contain', label: t('editor:clip.fitContain') },
          ]}
          value={clip.fit}
          onChange={(fit) => applyToScope({ fit })}
        />
      </section>

      <div className="space-y-2">
        <label className="flex items-center justify-between gap-3 rounded-xl border border-ink-600 bg-ink-850 p-3">
          <span className="text-sm text-ink-200">{t('editor:clip.kenBurns')}</span>
          <input
            type="checkbox"
            checked={kenBurnsOn}
            onChange={(event) =>
              applyToScope({
                kenBurns: event.target.checked
                  ? KEN_BURNS_PRESETS.zoomIn
                  : undefined,
              })
            }
            className="size-5 accent-[var(--color-beat-400)]"
          />
        </label>

        {kenBurnsOn && (
          <div className="space-y-1.5 pt-1">
            <h4 className="text-xs font-medium uppercase tracking-wide text-ink-400">
              {t('editor:clip.kenBurnsPresetLabel')}
            </h4>
            <div className="grid grid-cols-3 gap-2">
              {KEN_BURNS_KEYS.map((key) => {
                const activePreset = getKenBurnsPreset(clip.kenBurns);
                const translationKey = `editor:clip.kenBurnsPreset.${key}` as
                  | 'editor:clip.kenBurnsPreset.zoomIn'
                  | 'editor:clip.kenBurnsPreset.zoomOut'
                  | 'editor:clip.kenBurnsPreset.panLeft'
                  | 'editor:clip.kenBurnsPreset.panRight'
                  | 'editor:clip.kenBurnsPreset.panUp'
                  | 'editor:clip.kenBurnsPreset.panDown';
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      applyToScope({
                        kenBurns: KEN_BURNS_PRESETS[key],
                      })
                    }
                    aria-pressed={activePreset === key}
                    className={[
                      'min-h-11 rounded-lg border px-1 text-[11px] font-medium',
                      activePreset === key
                        ? 'border-beat-400 text-beat-400'
                        : 'border-ink-600 text-ink-200 active:bg-ink-800',
                    ].join(' ')}
                  >
                    {t(translationKey)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
          {t('editor:clip.filter')}
        </h3>

        <div className="grid grid-cols-4 gap-2">
          {FILTER_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset(preset)}
              aria-pressed={activePreset === preset}
              className={[
                'min-h-11 rounded-lg border px-1 text-[11px] font-medium',
                activePreset === preset
                  ? 'border-beat-400 text-beat-400'
                  : 'border-ink-600 text-ink-200 active:bg-ink-800',
              ].join(' ')}
            >
              {t(`editor:clip.filterPreset.${preset}`)}
            </button>
          ))}
        </div>

        {/* Le dosage n'a de sens qu'avec un look actif. */}
        {clip.filter && (
          <Slider
            label={t('editor:clip.filterIntensity')}
            value={clip.filter.intensity}
            min={0}
            max={1}
            step={0.05}
            onChange={applyIntensity}
            displayValue={formatPercent(clip.filter.intensity, i18n.language)}
          />
        )}

        <details className="rounded-xl border border-ink-600 bg-ink-850">
          <summary className="min-h-11 cursor-pointer list-none px-3 py-3 text-sm text-ink-200">
            {t('editor:clip.filterManual')}
          </summary>
          <div className="px-3 pb-2">
            <Slider
              label={t('editor:clip.brightness')}
              value={filter.brightness}
              min={0.5}
              max={1.5}
              onChange={(brightness) => setCustomFilter({ brightness })}
            />
            <Slider
              label={t('editor:clip.contrast')}
              value={filter.contrast}
              min={0.5}
              max={1.5}
              onChange={(contrast) => setCustomFilter({ contrast })}
            />
            <Slider
              label={t('editor:clip.saturation')}
              value={filter.saturation}
              min={0}
              max={2}
              onChange={(saturation) => setCustomFilter({ saturation })}
            />
            <Slider
              label={t('editor:clip.hueRotate')}
              value={filter.hueRotate}
              min={-60}
              max={60}
              step={1}
              onChange={(hueRotate) => setCustomFilter({ hueRotate })}
            />
          </div>
        </details>

        {/*
          Un seul bouton desormais: « Appliquer a tous » a disparu au profit du
          selecteur de portee, qui couvre le meme besoin pour TOUS les reglages
          et non pour le seul filtre. Garder les deux aurait laisse deux chemins
          concurrents vers le meme resultat.

          La reinitialisation suit la portee comme le reste.
        */}
        <button
          type="button"
          onClick={() => applyPreset('none')}
          className="min-h-11 w-full surface rounded-xl border border-ink-600 bg-ink-850 text-sm font-medium text-ink-200 active:bg-ink-800"
        >
          {t('editor:effects.resetFilter')}
        </button>
      </section>

      {/*
        Retrait de TOUS les effets, en pied de panneau.

        Pose en dernier et non pres des transitions: il defait le travail de
        toutes les sections au-dessus, donc le rencontrer avant elles inviterait
        a l'actionner sans savoir ce qu'il emporte.

        `danger-500` parce que le geste est destructif, et masque quand il n'y a
        rien a retirer — propose sur un montage vierge, il laisserait croire
        qu'un effet traine quelque part.
      */}
      {hasEffects && (
        <button
          type="button"
          onClick={clearEffects}
          className="min-h-11 w-full rounded-xl border border-danger-500 text-sm font-medium text-danger-500 active:bg-ink-800"
        >
          {scope === 'all'
            ? t('editor:effects.clearAllClips')
            : t('editor:effects.clearClip')}
        </button>
      )}
    </div>
  );
}
