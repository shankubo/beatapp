/**
 * Panneau Beat: analyse rythmique et repartition des clips sur les temps.
 *
 * C'est le panneau qui porte la promesse de l'application. Le bouton
 * "Repartir sur les temps" est l'action la plus valorisee de l'interface.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMedia } from '../preview/MediaProvider';
import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import { Segmented } from '../../components/ui/Segmented';
import { BeatIcon, CheckIcon } from '../../components/ui/icons';
import { analyzeAudio } from '../../audio/beatClient';
import { musicTrack } from '../../domain/project';
import { isLowConfidence } from '../../domain/beatmap';
import {
  BEAT_DIVISIONS,
  type BeatDivision,
  type BeatFeatureKind,
  type BeatMap,
} from '../../domain/types';
import { formatInteger } from '../../lib/format';

/** Criteres proposes, dans l'ordre de la grille. */
const CRITERIA: readonly BeatFeatureKind[] = [
  'beat',
  'onsets',
  'dynamics',
  'sections',
  'timbre',
];

/** Nombre d'instants disponibles pour un critere: 0 = a griser. */
function criterionCount(beatMap: BeatMap | undefined, kind: BeatFeatureKind): number {
  const features = beatMap?.features;
  if (!features) return 0;
  // `?? []`: une analyse v3 en cache ne porte pas encore les impulsions.
  if (kind === 'onsets') return (features.onsets ?? []).length;
  if (kind === 'dynamics') return features.dynamics.length;
  if (kind === 'sections') return features.sections.length;
  if (kind === 'timbre') return features.timbre.length;
  return beatMap?.beats.length ?? 0;
}

export function BeatSheet() {
  const { t, i18n } = useTranslation(['editor', 'errors']);

  const project = useProjectStore((state) => state.project);
  const setBeatMap = useProjectStore((state) => state.setBeatMap);
  const setSnapping = useProjectStore((state) => state.setSnapping);
  const distributeOnBeats = useProjectStore((state) => state.distributeOnBeats);
  const quantizeCuts = useProjectStore((state) => state.quantizeCuts);

  const { audioBuffers } = useMedia();
  const pushToast = useUiStore((state) => state.pushToast);

  const [analyzing, setAnalyzing] = useState(false);

  const track = musicTrack(project);
  const buffer = track ? audioBuffers.get(track.assetId) : undefined;
  const beatMap = project.beatMap;
  const hasClips = project.videoTrack.clips.length > 0;

  const runAnalysis = async () => {
    if (!track || !buffer) return;

    setAnalyzing(true);
    try {
      const result = await analyzeAudio(track.assetId, buffer);
      if (result.beats.length === 0) {
        // Aucun rythme detectable: on le dit, plutot que d'afficher 0 BPM.
        pushToast({ i18nKey: 'errors:audio.tooQuiet', tone: 'error' });
        return;
      }
      setBeatMap(result);
    } catch {
      pushToast({ i18nKey: 'errors:audio.analysisFailed', tone: 'error' });
    } finally {
      setAnalyzing(false);
    }
  };

  const divisionOptions = BEAT_DIVISIONS.map((division) => ({
    value: division,
    label: t(divisionLabelKey(division)),
  }));

  /**
   * Critere choisi, hors du store de projet.
   *
   * C'est un choix d'INTERFACE et non une donnee du montage: il ne doit ni entrer
   * dans l'historique d'annulation ni etre enregistre, sinon annuler une coupe
   * changerait aussi le critere selectionne.
   */
  const [criterion, setCriterion] = useState<BeatFeatureKind>('beat');

  if (!track || !buffer) {
    return <p className="py-6 text-center text-sm text-ink-400">{t('editor:beat.noAudio')}</p>;
  }

  return (
    <div className="space-y-5 pt-1">
      {!beatMap ? (
        <button
          type="button"
          onClick={() => void runAnalysis()}
          disabled={analyzing}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-beat-400 px-4 text-sm font-semibold text-ink-950 active:bg-beat-500 disabled:opacity-60 [&>svg]:size-5"
        >
          <BeatIcon />
          {analyzing ? t('editor:beat.analyzing') : t('editor:beat.analyze')}
        </button>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-xl border border-ink-600 bg-ink-850 p-3">
            <div>
              {/* Le BPM est l'information centrale: gros, en chiffres tabulaires. */}
              <p className="tnum text-2xl font-semibold leading-none text-beat-400">
                {formatInteger(Math.round(beatMap.bpm), i18n.language)}
                <span className="ml-1 text-xs font-medium text-ink-400">BPM</span>
              </p>
              <p className="mt-1 flex items-center gap-1 text-xs text-ink-400">
                {!isLowConfidence(beatMap) && (
                  <span className="text-beat-400 [&>svg]:size-3.5">
                    <CheckIcon />
                  </span>
                )}
                {isLowConfidence(beatMap)
                  ? t('editor:beat.confidenceLow')
                  : t('editor:beat.confidenceHigh')}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void runAnalysis()}
              disabled={analyzing}
              className="min-h-9 rounded-lg border border-ink-600 px-3 text-xs text-ink-200 active:bg-ink-800 disabled:opacity-60"
            >
              {t('editor:beat.reanalyze')}
            </button>
          </div>

          {/*
            Sur QUOI caler. Pose avant la division, car la division ne concerne que
            la pulsation: une rupture d'energie ou une frontiere de section est un
            instant precis, que subdiviser n'aurait aucun sens.
          */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
              {t('editor:beat.criterion')}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {CRITERIA.map((kind) => {
                const available = kind === 'beat' || criterionCount(project.beatMap, kind) > 0;
                return (
                  <button
                    key={kind}
                    type="button"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      if (available) setCriterion(kind);
                    }}
                    aria-pressed={criterion === kind}
                    // Grise plutot que masque: un critere absent d'UNE musique
                    // existe sur la suivante, et le faire disparaitre rendrait
                    // l'interface instable d'un morceau a l'autre.
                    disabled={!available}
                    className={[
                      'min-h-11 rounded-lg border px-2 text-xs font-medium',
                      criterion === kind
                        ? 'border-beat-400 text-beat-400'
                        : 'border-ink-600 text-ink-200 active:bg-ink-800',
                      available ? '' : 'opacity-60',
                    ].join(' ')}
                  >
                    {t(criterionLabelKey(kind))}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-ink-400">{t(criterionHintKey(criterion))}</p>
          </section>

          {/* La division n'a de sens que pour la pulsation. */}
          {criterion === 'beat' && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
                {t('editor:beat.division')}
              </h3>
              <Segmented
                label={t('editor:beat.division')}
                options={divisionOptions}
                value={project.snapping.division}
                onChange={(division) => setSnapping({ division })}
                tone="beat"
              />
            </section>
          )}

          <button
            type="button"
            // Enveloppe indispensable: `distributeOnBeats` attend des options,
            // et lui passer l'evenement de clic changerait son comportement.
            onClick={() => distributeOnBeats({ criterion })}
            disabled={!hasClips}
            className="w-full rounded-xl bg-beat-400 px-4 py-3.5 text-sm font-semibold text-ink-950 active:bg-beat-500 disabled:opacity-60"
          >
            {t('editor:beat.distribute')}
          </button>
          <p className="-mt-3 text-xs text-ink-400">{t('editor:beat.distributeHint')}</p>

          <button
            type="button"
            onClick={() => quantizeCuts()}
            disabled={!hasClips}
            className="w-full rounded-xl border border-ink-600 px-4 py-3 text-sm font-medium text-ink-50 active:bg-ink-800 disabled:opacity-60"
          >
            {t('editor:beat.quantize')}
          </button>

          <label className="flex items-center justify-between gap-3 rounded-xl border border-ink-600 bg-ink-850 p-3">
            <span className="text-sm text-ink-200">{t('editor:beat.snap')}</span>
            <input
              type="checkbox"
              checked={project.snapping.enabled}
              onChange={(event) => setSnapping({ enabled: event.target.checked })}
              className="size-5 accent-[var(--color-beat-400)]"
            />
          </label>
        </>
      )}
    </div>
  );
}

/** Cles completes, pour rester verifiables a la compilation. */
function divisionLabelKey(division: BeatDivision) {
  switch (division) {
    case 0.5:
      return 'editor:beat.divisionBar' as const;
    case 1:
      return 'editor:beat.divisionBeat' as const;
    case 2:
      return 'editor:beat.divisionHalf' as const;
    case 4:
      return 'editor:beat.divisionQuarter' as const;
  }
}

/** Cles completes, pour rester verifiables a la compilation. */
function criterionLabelKey(kind: BeatFeatureKind) {
  switch (kind) {
    case 'beat':
      return 'editor:beat.criterionBeat' as const;
    case 'onsets':
      return 'editor:beat.criterionOnsets' as const;
    case 'dynamics':
      return 'editor:beat.criterionDynamics' as const;
    case 'sections':
      return 'editor:beat.criterionSections' as const;
    case 'timbre':
      return 'editor:beat.criterionTimbre' as const;
  }
}

function criterionHintKey(kind: BeatFeatureKind) {
  switch (kind) {
    case 'beat':
      return 'editor:beat.criterionBeatHint' as const;
    case 'onsets':
      return 'editor:beat.criterionOnsetsHint' as const;
    case 'dynamics':
      return 'editor:beat.criterionDynamicsHint' as const;
    case 'sections':
      return 'editor:beat.criterionSectionsHint' as const;
    case 'timbre':
      return 'editor:beat.criterionTimbreHint' as const;
  }
}
