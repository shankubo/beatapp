/**
 * Detail d'un modele: apercu anime, effet annonce, et une seule action.
 *
 * UNE seule tuile animee a la fois, jamais N. Cinq canvas redessines a 60 Hz
 * avec des filtres sur un telephone milieu de gamme est un pari non mesure; la
 * grille se contente donc de schemas statiques, et l'animation n'existe qu'ici.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { planTemplate } from '../../domain/template';
import { musicTrack } from '../../domain/project';
import { timelineGrid } from '../../domain/snapping';
import { draw } from '../../engine/Compositor';
import { buildScene } from '../../engine/SceneGraph';
import { useProjectStore } from '../../store/useProjectStore';
import { isProjectEmpty } from '../onboarding/onboardingState';
import { findGeneratedSample } from './sampleGen';
import { TemplateSchematic } from './TemplateSchematic';
import { useApplyTemplate } from './useApplyTemplate';
import { previewCache, previewCards, previewProject } from './templatePreview';
import { formatDuration, formatInteger } from '../../lib/format';
import type { Template } from '../../domain/template';

/** Largeur du backing store. L'apercu fait ~180 px a l'ecran. */
const PREVIEW_WIDTH = 270;

export function TemplateDetail({
  template,
  onApplied,
}: {
  template: Template;
  onApplied: () => void;
}) {
  const { t, i18n } = useTranslation(['samples', 'common']);
  const project = useProjectStore((state) => state.project);
  const { apply, busy } = useApplyTemplate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  const empty = isProjectEmpty(project);
  const sample = template.suggestedSampleId
    ? findGeneratedSample(template.suggestedSampleId)
    : undefined;

  /*
    Ce que le modele fera, calcule sur le VRAI projet.

    C'est ce qui permet d'annoncer avant d'agir: un modele qui reorganise tout
    un montage merite de dire son effet plutot que de le reveler apres coup.
  */
  const grid = project.beatMap
    ? timelineGrid(project.beatMap, musicTrack(project), template.division)
    : [];
  const plan = planTemplate(project, template, { grid, fps: project.frame.fps });

  // --- Apercu anime.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let frame = 0;
    let cancelled = false;
    let startedAt = 0;

    void (async () => {
      const cards = await previewCards();
      if (cancelled || cards.length === 0) return;

      const preview = previewProject(template, cards.length);
      const cache = previewCache(cards);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const duration = preview.videoTrack.clips.reduce(
        (total, clip) => total + clip.duration,
        0,
      );
      setReady(true);

      const tick = (now: number) => {
        if (cancelled) return;
        startedAt ||= now;
        // La boucle repart a zero: un modele se juge sur sa cadence, qu'il faut
        // pouvoir observer plusieurs fois sans relancer quoi que ce soit.
        const time = duration > 0 ? ((now - startedAt) / 1000) % duration : 0;
        draw(buildScene(preview, time, cache), {
          ctx,
          width: canvas.width,
          height: canvas.height,
        });
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    })();

    /*
      Arret imperatif au demontage.

      Une boucle rAF orpheline derriere un ecran ferme consomme la batterie en
      silence — le genre de defaut qu'aucun test ne rattrape et que personne ne
      remarque avant de voir chauffer son telephone.
    */
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [template]);

  const height = Math.round((PREVIEW_WIDTH * project.frame.height) / project.frame.width);

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2">
        <canvas
          ref={canvasRef}
          width={PREVIEW_WIDTH}
          height={height}
          aria-label={t('samples:templates.previewLabel')}
          className="w-[min(60vw,11rem)] rounded-xl border border-ink-700 bg-black"
          style={{ aspectRatio: `${project.frame.width} / ${project.frame.height}` }}
        />
        {ready && (
          <p className="text-center text-[11px] leading-snug text-ink-400">
            {t('samples:templates.previewHint')}
          </p>
        )}
      </div>

      <div>
        <h3 className="text-base font-semibold text-ink-50">{t(template.nameKey)}</h3>
        <p className="mt-1 text-sm leading-relaxed text-ink-400">
          {t(template.descriptionKey)}
        </p>
      </div>

      <TemplateSchematic template={template} />

      {/* Faits: ce que le modele produira, en clair. */}
      <ul className="space-y-1 text-xs text-ink-300">
        <li className="tnum">
          {t('samples:templates.duration', {
            value: formatInteger(template.targetDuration, i18n.language),
          })}
          {' · '}
          {t('samples:templates.clipsHint', { count: template.suggestedClips })}
          {' · '}
          {t('samples:templates.cuts', { count: Math.max(0, template.suggestedClips - 1) })}
        </li>
        <li>{t(plan.onBeat ? 'samples:templates.onBeat' : 'samples:templates.uniform')}</li>
        {sample && !musicTrack(project) && (
          <li className="text-audio-400">
            {t('samples:templates.withMusic', { bpm: sample.bpm })}
          </li>
        )}
        {plan.clipCount > 0 && (
          <li className="tnum text-ink-400">
            {t('samples:templates.duration', {
              value: formatDuration(plan.resultingDuration, i18n.language),
            })}
          </li>
        )}
      </ul>

      {/* Avertissement mesure: appliquer en silence un modele qui ne convient
          pas au nombre de plans donnerait un resultat decevant sans explication. */}
      {plan.clipMismatch !== 'ok' && (
        <p className="rounded-xl border border-ink-600 bg-ink-850 p-3 text-xs leading-relaxed text-ink-300">
          {t(
            plan.clipMismatch === 'tooFew'
              ? 'samples:templates.warn.tooFew'
              : 'samples:templates.warn.tooMany',
            { count: template.suggestedClips },
          )}
        </p>
      )}

      {/*
        UN seul bouton, dont le libelle et l'effet DERIVENT du projet.

        La difference « nouveau reel » / « appliquer a mon montage » n'est jamais
        posee en question a l'utilisateur: elle se deduit. Deux boutons de poids
        egal l'obligeraient a trancher une question qu'il ne se pose pas.

        Chartreuse assume: appliquer un modele EST une operation de rythme — il
        pose la division, la cadence et la repartition sur les temps.
      */}
      <button
        type="button"
        onClick={() => void apply(template).then(onApplied)}
        disabled={busy}
        className="min-h-11 w-full rounded-xl bg-beat-400 text-sm font-semibold text-ink-950 active:opacity-90 disabled:opacity-60"
      >
        {t(empty ? 'samples:templates.action.start' : 'samples:templates.action.apply')}
      </button>

      {!empty && (
        <p className="text-center text-[11px] leading-snug text-ink-400">
          {t('samples:templates.action.startNewHint')}
        </p>
      )}
    </div>
  );
}
