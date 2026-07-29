/**
 * Regle des beats — l'element signature de l'interface.
 *
 * Les ticks ne sont pas uniformes: leur HAUTEUR encode la force d'attaque
 * mesuree, et les temps forts sont pleine hauteur. La regle affiche donc une
 * information reelle extraite du signal, au lieu de decorer. C'est ce qui
 * permet a l'utilisateur de reconnaitre visuellement la structure de sa musique
 * et de poser ses coupes en connaissance de cause.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useMedia } from '../preview/MediaProvider';
import { useProjectStore } from '../../store/useProjectStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { musicTrack } from '../../domain/project';
import { timelineGrid } from '../../domain/snapping';
import { computePeaksForRange, drawWaveform, type WaveformPeaks } from '../../audio/waveform';
import { videoDuration } from '../../domain/timeline';
import { lastIndexAtOrBefore } from '../../lib/math';

interface BeatRulerProps {
  pxPerSecond: number;
  /** Largeur visible, en pixels CSS. */
  viewportWidth: number;
  /** Decalage de defilement, en secondes. */
  scrollTime: number;
}

export function BeatRuler({ pxPerSecond, viewportWidth, scrollTime }: BeatRulerProps) {
  const { t } = useTranslation('editor');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const project = useProjectStore((state) => state.project);
  const { audioBuffers } = useMedia();
  const setTime = usePlaybackStore((state) => state.setTime);

  const music = musicTrack(project);
  const buffer = music ? audioBuffers.get(music.assetId) : undefined;
  const duration = videoDuration(project.videoTrack);

  /** Grille de beats en temps timeline, pour la division courante. */
  const grid = useMemo(() => {
    if (!project.beatMap) return [];
    return timelineGrid(project.beatMap, music, project.snapping.division);
  }, [project.beatMap, music, project.snapping.division]);

  /** Force de chaque point de grille, alignee sur `grid`. */
  const strengths = useMemo(() => {
    const beatMap = project.beatMap;
    if (!beatMap) return [];
    const offset = music ? music.start - music.source.in : 0;
    return grid.map((timelineTime) => {
      const index = lastIndexAtOrBefore(beatMap.beats, timelineTime - offset);
      return index >= 0 ? (beatMap.strength[index] ?? 0.5) : 0.5;
    });
  }, [grid, project.beatMap, music]);

  /** Indices des temps forts, pour les distinguer visuellement. */
  const downbeatSet = useMemo(() => {
    const beatMap = project.beatMap;
    if (!beatMap || project.snapping.division !== 1) return new Set<number>();
    const set = new Set<number>();
    for (let i = beatMap.barOffset; i < grid.length; i += beatMap.beatsPerBar) {
      set.add(i);
    }
    return set;
  }, [grid.length, project.beatMap, project.snapping.division]);

  /**
   * Portion VISIBLE de la musique, en temps timeline.
   *
   * L'ancienne version bornait le debut a `Math.max(0, ...)` et dessinait
   * toujours sur toute la largeur: quand la fenetre commencait avant le debut
   * de la musique, l'onde etait etiree sur la zone vide et ne correspondait
   * plus au bloc violet de la piste audio (mesure: bloc a 575 px, onde tracee
   * depuis 0). On calcule donc l'intersection reelle, et on dessine a sa place.
   */
  const visibleMusic = useMemo(() => {
    if (!buffer || !music || viewportWidth <= 0 || pxPerSecond <= 0) return null;

    const audible = Math.max(0, music.source.out - music.source.in);
    const windowStart = scrollTime;
    const windowEnd = scrollTime + viewportWidth / pxPerSecond;

    // Intersection entre la fenetre affichee et l'etendue de la musique.
    const from = Math.max(music.start, windowStart);
    const to = Math.min(music.start + audible, windowEnd);
    if (to <= from) return null;

    const left = (from - scrollTime) * pxPerSecond;
    const width = (to - from) * pxPerSecond;
    if (width < 1) return null;

    return {
      // Temps SOURCE correspondants: la musique peut etre rognee en tete.
      sourceFrom: music.source.in + (from - music.start),
      sourceTo: music.source.in + (to - music.start),
      left,
      width,
    };
  }, [buffer, music, scrollTime, viewportWidth, pxPerSecond]);

  const peaks = useMemo<WaveformPeaks | null>(() => {
    if (!buffer || !visibleMusic) return null;
    // On n'extrait les pics que de la portion visible: recalculer toute la
    // forme d'onde a chaque defilement serait inutilement couteux.
    return computePeaksForRange(
      buffer,
      visibleMusic.sourceFrom,
      visibleMusic.sourceTo,
      Math.max(1, Math.ceil(visibleMusic.width / 2)),
    );
  }, [buffer, visibleMusic]);

  // Rendu de la forme d'onde et des ticks.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewportWidth <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(viewportWidth * dpr);
    const height = Math.round(34 * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewportWidth, 34);

    if (peaks && visibleMusic) {
      /*
        L'onde est dessinee A SA PLACE et non sur toute la largeur.

        `drawWaveform` trace toujours de 0 a `width`: on translate donc le
        repere pour que ce zero tombe la ou la musique commence reellement.
        Sans cela, l'onde s'etalait sur toute la regle alors que le bloc de la
        piste audio, lui, respectait le temps — les deux representations du meme
        son ne se correspondaient pas.
      */
      ctx.save();
      ctx.translate(visibleMusic.left, 0);
      drawWaveform(ctx, peaks, {
        width: visibleMusic.width,
        height: 20,
        color: 'rgba(210, 215, 204, 0.28)',
      });
      ctx.restore();
    }

    // Ticks: la hauteur encode la force d'attaque.
    const tickAreaTop = 21;
    const tickAreaHeight = 12;

    for (let i = 0; i < grid.length; i += 1) {
      const x = (grid[i]! - scrollTime) * pxPerSecond;
      if (x < -2 || x > viewportWidth + 2) continue;

      const isDownbeat = downbeatSet.has(i);
      const strength = strengths[i] ?? 0.5;
      // Un temps fort occupe toute la hauteur; les autres sont proportionnels
      // a leur force, avec un plancher pour rester visibles.
      const relative = isDownbeat ? 1 : 0.35 + strength * 0.5;
      const tickHeight = tickAreaHeight * relative;

      ctx.fillStyle = isDownbeat ? 'rgba(232, 255, 58, 0.95)' : 'rgba(232, 255, 58, 0.5)';
      ctx.fillRect(
        Math.round(x) - (isDownbeat ? 1 : 0.5),
        tickAreaTop + (tickAreaHeight - tickHeight),
        isDownbeat ? 2 : 1,
        tickHeight,
      );
    }
  }, [peaks, visibleMusic, grid, strengths, downbeatSet, pxPerSecond, scrollTime, viewportWidth]);

  /** Taper sur un tick deplace la tete de lecture exactement dessus. */
  const handleTap = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const time = scrollTime + (event.clientX - rect.left) / pxPerSecond;

    // Aimantation sur le beat le plus proche s'il est a portee visuelle (12 px).
    const tolerance = 12 / pxPerSecond;
    let target = time;
    let best = tolerance;
    for (const beat of grid) {
      const distance = Math.abs(beat - time);
      if (distance < best) {
        best = distance;
        target = beat;
      }
    }

    setTime(Math.max(0, Math.min(duration, target)));
  };

  return (
    <div
      className="relative h-ruler shrink-0 touch-none border-b border-ink-700"
      onPointerDown={handleTap}
      // Role d'image et non de curseur: le deplacement de la tete de lecture
      // se fait au clavier via la barre de transport, qui expose de vraies
      // commandes. Annoncer un curseur ici, sans gestion des fleches, serait
      // une promesse d'accessibilite non tenue.
      role="img"
      aria-label={t('beat.ruler')}
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{ width: viewportWidth, height: 34 }}
        aria-hidden="true"
      />
    </div>
  );
}
