/**
 * Editeur audio: bornes, decoupage, calage manuel.
 *
 * La forme d'onde est le seul endroit ou l'utilisateur peut voir OU il coupe.
 * Elle est donc zoomable (pincement a deux doigts) et defilable, et elle
 * superpose trois informations dans le meme repere temporel:
 * - le signal, pour reconnaitre les passages;
 * - les temps detectes, pour couper en mesure;
 * - les frontieres des segments conserves, pour comprendre le montage.
 *
 * Les poignees de bornes ont une cible tactile de 44 px pour un trait visuel de
 * 2 px, obtenue par une zone transparente rembourree: au pouce, une poignee de
 * 2 px est inatteignable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDrag, usePinch } from '@use-gesture/react';

import { useProjectStore } from '../../store/useProjectStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { useMedia } from '../preview/MediaProvider';
import { Slider } from '../../components/ui/Slider';
import { CutIcon, TrashIcon } from '../../components/ui/icons';
import { computePeaksForRange, drawWaveform, type WaveformPeaks } from '../../audio/waveform';
import { segmentsDuration, trackSegments } from '../../domain/audioEdit';
import { divisionGrid } from '../../domain/beatmap';
import type { AudioTrack, MediaAsset } from '../../domain/types';
import { formatDuration } from '../../lib/format';
import { clamp } from '../../lib/math';

/** Hauteur du trace, en pixels CSS. Assez pour distinguer un couplet d'un refrain. */
const WAVE_HEIGHT = 96;

/** Bornes de zoom, en facteur de la largeur visible. 1 = tout le morceau. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 40;

/** Pas de calage fin, en secondes. */
const NUDGE_STEP = 0.05;

interface AudioEditorProps {
  track: AudioTrack;
  asset: MediaAsset;
}

export function AudioEditor({ track, asset }: AudioEditorProps) {
  const { t, i18n } = useTranslation(['editor', 'common']);

  const project = useProjectStore((state) => state.project);
  const setAudioRange = useProjectStore((state) => state.setAudioRange);
  const splitAudio = useProjectStore((state) => state.splitAudio);
  const removeAudioSegment = useProjectStore((state) => state.removeAudioSegment);
  const setAudioOffset = useProjectStore((state) => state.setAudioOffset);

  const currentTime = usePlaybackStore((state) => state.time);
  const setTime = usePlaybackStore((state) => state.setTime);

  const { audioBuffers } = useMedia();
  const buffer = audioBuffers.get(asset.id);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(MIN_ZOOM);
  /** Debut de la fenetre visible, en secondes de la SOURCE. */
  const [scroll, setScroll] = useState(0);
  const [width, setWidth] = useState(0);

  const sourceDuration = asset.duration ?? 0;
  const segments = useMemo(() => trackSegments(track), [track]);

  // Fenetre visible: `zoom` fois plus petite que le morceau entier.
  const visibleDuration = sourceDuration / zoom;
  const maxScroll = Math.max(0, sourceDuration - visibleDuration);
  const windowStart = clamp(scroll, 0, maxScroll);
  const windowEnd = windowStart + visibleDuration;

  /** Position de la souris/du doigt -> temps source. */
  const timeAt = useCallback(
    (clientX: number): number => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return windowStart;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      return windowStart + ratio * visibleDuration;
    },
    [windowStart, visibleDuration],
  );

  /** Temps source -> fraction de la largeur visible, ou `null` si hors champ. */
  const ratioOf = useCallback(
    (time: number): number | null => {
      if (visibleDuration <= 0) return null;
      const ratio = (time - windowStart) / visibleDuration;
      return ratio >= -0.05 && ratio <= 1.05 ? ratio : null;
    },
    [windowStart, visibleDuration],
  );

  // Largeur observee: le canvas doit avoir la resolution du peripherique, sinon
  // le trace est flou sur un ecran a haute densite.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /**
   * Pics de la fenetre visible.
   *
   * Recalcules a chaque changement de zoom ou de defilement: c'est ce qui donne
   * du detail en zoomant, plutot qu'un agrandissement flou d'une image basse
   * resolution.
   */
  const peaks = useMemo<WaveformPeaks | null>(() => {
    if (!buffer || width <= 0) return null;
    // Un bucket par pixel: au-dela, on calcule des details invisibles.
    const buckets = Math.max(32, Math.floor(width));
    return computePeaksForWindow(buffer, windowStart, windowEnd, buckets);
  }, [buffer, width, windowStart, windowEnd]);

  // Dessin. Hors React: on peint des pixels, pas des elements.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || width <= 0) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(WAVE_HEIGHT * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWaveform(ctx, peaks, {
      width,
      height: WAVE_HEIGHT,
      color: '#4a4d46',
      background: '#141613',
    });

    // Les portions CONSERVEES sont repeintes par-dessus en clair: ce qui est
    // sombre est ce qui a ete retire, une lecture immediate du montage.
    for (const segment of segments) {
      const from = Math.max(segment.in, windowStart);
      const to = Math.min(segment.out, windowEnd);
      if (to <= from) continue;

      const x = ((from - windowStart) / visibleDuration) * width;
      const segmentWidth = ((to - from) / visibleDuration) * width;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, segmentWidth, WAVE_HEIGHT);
      ctx.clip();
      drawWaveform(ctx, peaks, {
        width,
        height: WAVE_HEIGHT,
        color: '#c9d1c4',
      });
      ctx.restore();
    }
  }, [peaks, width, segments, windowStart, windowEnd, visibleDuration]);

  /** Pincement: zoom ancre sur le centre du geste, pas sur le bord. */
  const bindPinch = usePinch(
    ({ offset: [scale], origin: [originX] }) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const anchorTime = rect ? timeAt(originX) : windowStart;
      const nextZoom = clamp(scale, MIN_ZOOM, MAX_ZOOM);
      const nextVisible = sourceDuration / nextZoom;

      // On conserve le temps sous les doigts a la meme position a l'ecran.
      const ratio = rect && rect.width > 0 ? (originX - rect.left) / rect.width : 0.5;
      setZoom(nextZoom);
      setScroll(clamp(anchorTime - ratio * nextVisible, 0, Math.max(0, sourceDuration - nextVisible)));
    },
    { scaleBounds: { min: MIN_ZOOM, max: MAX_ZOOM }, from: () => [zoom, 0] },
  );

  /**
   * Glissement horizontal: defilement quand on est zoome, sinon deplacement de
   * la tete de lecture. Ce sont deux gestes exclusifs, et l'ambiguite est levee
   * par le niveau de zoom — au zoom 1 il n'y a rien a faire defiler.
   */
  const bindDrag = useDrag(
    ({ delta: [dx], xy: [x], tap }) => {
      if (tap) {
        // Un appui deplace la lecture, en temps TIMELINE.
        const sourceTime = timeAt(x);
        setTime(Math.max(0, sourceTime - track.source.in + track.start));
        return;
      }
      if (zoom > MIN_ZOOM && width > 0) {
        const perPixel = visibleDuration / width;
        setScroll((previous) => clamp(previous - dx * perPixel, 0, maxScroll));
      }
    },
    { axis: 'x', filterTaps: true, pointer: { touch: true } },
  );

  if (!buffer || sourceDuration <= 0) {
    return <p className="py-4 text-center text-sm text-ink-400">{t('editor:audio.cannotEdit')}</p>;
  }

  const audible = segmentsDuration(segments);
  /** Position de lecture ramenee en temps SOURCE. */
  const playheadSource = currentTime - track.start + track.source.in;

  // Grille des temps, pour couper en mesure. Recalculee a chaque rendu mais
  // bornee a la fenetre visible: quelques dizaines de valeurs au plus.
  const beatTicks = project.beatMap
    ? divisionGrid(project.beatMap, project.snapping.division).filter(
        (time) => time >= windowStart && time <= windowEnd,
      )
    : [];

  return (
    <div className="space-y-4">
      {/* --- Forme d'onde --- */}
      <div>
        <div
          ref={containerRef}
          {...bindPinch()}
          {...bindDrag()}
          role="group"
          aria-label={t('editor:audio.waveform')}
          className="relative touch-none overflow-hidden rounded-xl border border-ink-600 bg-ink-850"
          style={{ height: WAVE_HEIGHT }}
        >
          <canvas
            ref={canvasRef}
            className="block size-full"
            style={{ width: '100%', height: WAVE_HEIGHT }}
          />

          {/* Temps detectes: reperes fins, sous les poignees. */}
          {beatTicks.map((time) => {
            const ratio = ratioOf(time);
            return ratio === null ? null : (
              <span
                key={time}
                aria-hidden="true"
                className="pointer-events-none absolute top-0 h-2 w-px bg-beat-400/60"
                style={{ left: `${ratio * 100}%` }}
              />
            );
          })}

          {/* Bornes de l'extrait: poignees deplacables. */}
          <RangeHandle
            label={t('editor:audio.rangeStart')}
            ratio={ratioOf(track.source.in)}
            onMove={(clientX) => {
              const next = timeAt(clientX);
              // Une borne de debut ne peut pas depasser la borne de fin.
              setAudioRange(track.id, {
                in: Math.min(next, track.source.out - 0.1),
                out: track.source.out,
              });
            }}
          />
          <RangeHandle
            label={t('editor:audio.rangeEnd')}
            ratio={ratioOf(track.source.out)}
            onMove={(clientX) => {
              const next = timeAt(clientX);
              setAudioRange(track.id, {
                in: track.source.in,
                out: Math.max(next, track.source.in + 0.1),
              });
            }}
          />

          {/* Tete de lecture. */}
          {(() => {
            const ratio = ratioOf(playheadSource);
            return ratio === null ? null : (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-ink-50"
                style={{ left: `${ratio * 100}%` }}
              />
            );
          })()}
        </div>

        <div className="mt-1 flex items-center justify-between">
          <span className="tnum text-xs text-ink-500">
            {formatDuration(windowStart, i18n.language)}
          </span>
          <span className="tnum text-xs text-ink-400">
            {t('editor:audio.audibleDuration')} {formatDuration(audible, i18n.language)}
          </span>
          <span className="tnum text-xs text-ink-500">
            {formatDuration(windowEnd, i18n.language)}
          </span>
        </div>
      </div>

      {/* --- Zoom --- */}
      <Slider
        label={t('editor:audio.waveform')}
        value={zoom}
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        step={0.5}
        onChange={setZoom}
        displayValue={`${Math.round(zoom)}×`}
      />

      {/* --- Bornes --- */}
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
          {t('editor:audio.rangeTitle')}
        </h3>
        <p className="text-xs text-ink-400">{t('editor:audio.rangeHint')}</p>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() =>
              setAudioRange(track.id, {
                in: Math.min(playheadSource, track.source.out - 0.1),
                out: track.source.out,
              })
            }
            className="min-h-11 rounded-lg border border-ink-600 text-xs font-medium text-ink-200 active:bg-ink-800"
          >
            {t('editor:audio.useCurrentAsStart')}
          </button>
          <button
            type="button"
            onClick={() =>
              setAudioRange(track.id, {
                in: track.source.in,
                out: Math.max(playheadSource, track.source.in + 0.1),
              })
            }
            className="min-h-11 rounded-lg border border-ink-600 text-xs font-medium text-ink-200 active:bg-ink-800"
          >
            {t('editor:audio.useCurrentAsEnd')}
          </button>
        </div>
      </section>

      {/* --- Decoupage --- */}
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
          {t('editor:audio.cutTitle')}
        </h3>
        <p className="text-xs text-ink-400">{t('editor:audio.cutHint')}</p>

        <button
          type="button"
          onClick={() => splitAudio(track.id, playheadSource)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-ink-600 text-sm font-medium text-ink-200 active:bg-ink-800 [&>svg]:size-4"
        >
          <CutIcon />
          {t('editor:audio.cutHere')}
        </button>

        {segments.length > 1 && (
          <ul className="space-y-1.5">
            {segments.map((segment, index) => (
              <li key={segment.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2">
                  <span className="block text-xs text-ink-200">
                    {t('editor:audio.segment', { index: index + 1 })}
                  </span>
                  <span className="tnum block text-[11px] text-ink-500">
                    {formatDuration(segment.in, i18n.language)} –{' '}
                    {formatDuration(segment.out, i18n.language)}
                  </span>
                </span>
                {/*
                  Deux suppressions distinctes, offertes AU MOMENT de detruire.

                  Le reglage vivait dans l'aimant de la piste, donc pose a
                  l'avance puis oublie — alors qu'une meme musique contient des
                  passages qu'on veut recoller et d'autres qu'on veut trouer.
                */}
                <button
                  type="button"
                  onClick={() => removeAudioSegment(track.id, segment.id, { leaveGap: false })}
                  aria-label={t('editor:audio.removeSegmentClose')}
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-400 active:bg-ink-800 [&>svg]:size-4"
                >
                  <TrashIcon />
                </button>
                <button
                  type="button"
                  onClick={() => removeAudioSegment(track.id, segment.id, { leaveGap: true })}
                  aria-label={t('editor:audio.removeSegmentGap')}
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-ink-600 text-[10px] font-medium text-ink-400 active:bg-ink-800"
                >
                  {t('editor:audio.gapShort')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Calage manuel --- */}
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
          {t('editor:audio.syncTitle')}
        </h3>
        <p className="text-xs text-ink-400">{t('editor:audio.syncHint')}</p>

        <Slider
          label={t('editor:audio.offset')}
          value={track.start}
          min={0}
          max={5}
          step={NUDGE_STEP}
          onChange={(start) => setAudioOffset(track.id, start)}
          displayValue={formatDuration(track.start, i18n.language)}
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setAudioOffset(track.id, track.start - NUDGE_STEP)}
            className="min-h-11 rounded-lg border border-ink-600 text-xs font-medium text-ink-200 active:bg-ink-800"
          >
            {t('editor:audio.nudgeBack')}
          </button>
          <button
            type="button"
            onClick={() => setAudioOffset(track.id, track.start + NUDGE_STEP)}
            className="min-h-11 rounded-lg border border-ink-600 text-xs font-medium text-ink-200 active:bg-ink-800"
          >
            {t('editor:audio.nudgeForward')}
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * Poignee de borne.
 *
 * La cible tactile fait 44 px de large et est transparente; seul un trait de
 * 2 px est visible. C'est ce qui rend la poignee saisissable au pouce sans
 * masquer la forme d'onde.
 */
function RangeHandle({
  label,
  ratio,
  onMove,
}: {
  label: string;
  ratio: number | null;
  onMove: (clientX: number) => void;
}) {
  const bind = useDrag(
    ({ xy: [x], event }) => {
      // Le glissement de la poignee ne doit pas faire defiler la forme d'onde.
      event.stopPropagation();
      onMove(x);
    },
    { axis: 'x', pointer: { touch: true }, eventOptions: { capture: true } },
  );

  if (ratio === null) return null;

  return (
    <span
      {...bind()}
      role="slider"
      aria-label={label}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      className="absolute inset-y-0 -ml-5 w-11 touch-none"
      style={{ left: `${ratio * 100}%` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-beat-400"
      />
      {/* Pastille de prise, visible sans encombrer. */}
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-950 bg-beat-400"
      />
    </span>
  );
}

/**
 * Pics de la fenetre visible.
 *
 * Les bornes sont clampees au buffer avant l'appel: `computePeaksForRange` les
 * clampe aussi, mais une fenetre inversee (`to <= from`) produirait une division
 * par zero silencieuse.
 */
function computePeaksForWindow(
  buffer: AudioBuffer,
  from: number,
  to: number,
  buckets: number,
): WaveformPeaks {
  const safeFrom = Math.max(0, from);
  const safeTo = Math.min(buffer.duration, Math.max(safeFrom + 0.001, to));
  return computePeaksForRange(buffer, safeFrom, safeTo, buckets);
}
