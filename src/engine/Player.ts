/**
 * Lecture temps reel de l'apercu.
 *
 * Architecture:
 * - l'audio est planifie UNE FOIS par play/seek via `AudioBufferSourceNode`
 *   (precis a l'echantillon, aucun travail audio par frame);
 * - la boucle rAF demande l'heure a `PlaybackClock` (asservie a l'AudioContext)
 *   et dessine, sans jamais faire avancer le temps elle-meme.
 *
 * Le dessin passe par `Compositor.draw`, exactement comme l'export.
 */

import { draw } from './Compositor';
import { buildScene } from './SceneGraph';
import { PlaybackClock } from './Clock';
import type { MediaCache } from './MediaCache';
import { videoDuration } from '../domain/timeline';
import { scheduleSegments, segmentsDuration, trackSegments } from '../domain/audioEdit';
import { MAX_PREVIEW_RATE, MIN_PREVIEW_RATE, type Project, type Seconds } from '../domain/types';
import { clamp } from '../lib/math';

export interface PlayerCallbacks {
  /** Appele a chaque frame rendue, avec le temps courant. */
  onTimeUpdate?: (time: Seconds) => void;
  /** Appele quand la lecture atteint la fin. */
  onEnded?: () => void;
}

interface AudioVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * Un `AudioBuffer` par piste audio du projet, deja decode.
 * Le lecteur ne decode rien: c'est la couche audio de l'application qui fournit
 * les buffers, ce qui garde `Player` synchrone et testable.
 */
export type AudioBuffers = ReadonlyMap<string, AudioBuffer>;

export class Player {
  private clock: PlaybackClock;
  private rafId: number | null = null;
  private voices: AudioVoice[] = [];
  private playing = false;
  /** Position courante quand la lecture est arretee. */
  private pausedAt: Seconds = 0;
  /**
   * Vitesse de l'APERCU, pas du montage.
   *
   * Elle n'affecte ni le projet ni l'export: c'est un outil de travail, pour
   * placer un texte ou une image au dixieme de seconde en regardant l'aperçu au
   * ralenti. L'export a son horloge deterministe propre et ignore cette valeur —
   * c'est ce qui garantit qu'un ralenti de travail ne fuit pas dans le MP4.
   */
  private rate = 1;

  constructor(
    private readonly context: AudioContext,
    private readonly canvas: HTMLCanvasElement,
    private readonly cache: MediaCache,
    private project: Project,
    private audioBuffers: AudioBuffers,
    private readonly callbacks: PlayerCallbacks = {},
  ) {
    this.clock = new PlaybackClock(context, 0);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentTime(): Seconds {
    return this.playing ? this.clampTime(this.clock.now()) : this.pausedAt;
  }

  /**
   * Met a jour le projet rendu. Pendant la lecture, un changement de montage
   * n'interrompt pas le son: seule l'image suit, ce qui permet d'editer en
   * ecoutant.
   */
  setProject(project: Project): void {
    this.project = project;
    if (!this.playing) this.renderFrame(this.pausedAt);
  }

  /**
   * Change la vitesse de l'apercu.
   *
   * Pendant la lecture, l'audio deja planifie porte l'ancienne vitesse: il faut
   * donc le replanifier, exactement comme pour un changement de buffers. Sans
   * cela l'image ralentirait et le son continuerait a plein regime.
   */
  setRate(rate: number): void {
    const next = clamp(rate, MIN_PREVIEW_RATE, MAX_PREVIEW_RATE);
    if (next === this.rate) return;

    const at = this.currentTime;
    this.rate = next;
    this.clock.setRate(next);

    if (this.playing) {
      this.stopVoices();
      this.scheduleVoices(at);
    }
  }

  get playbackRate(): number {
    return this.rate;
  }

  setAudioBuffers(buffers: AudioBuffers): void {
    this.audioBuffers = buffers;
    if (this.playing) {
      // Les voix planifiees sont perimees: on replanifie a la position courante.
      const at = this.currentTime;
      this.stopVoices();
      this.scheduleVoices(at);
    }
  }

  async play(): Promise<void> {
    if (this.playing) return;

    // Sur mobile, l'AudioContext demarre suspendu jusqu'a une interaction.
    if (this.context.state === 'suspended') await this.context.resume();

    const from = this.pausedAt >= this.duration ? 0 : this.pausedAt;

    this.playing = true;
    this.clock.rebase(from);
    this.scheduleVoices(from);
    this.startLoop();
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedAt = this.clampTime(this.clock.now());
    this.playing = false;
    this.stopVoices();
    this.stopLoop();
    this.renderFrame(this.pausedAt);
  }

  /** Deplace la tete de lecture. Fonctionne a l'arret comme en lecture. */
  seek(time: Seconds): void {
    const target = this.clampTime(time);
    this.pausedAt = target;

    if (this.playing) {
      this.clock.rebase(target);
      this.stopVoices();
      this.scheduleVoices(target);
    } else {
      this.renderFrame(target);
    }
  }

  /** Redessine la frame courante (apres un redimensionnement du canvas). */
  refresh(): void {
    this.renderFrame(this.currentTime);
  }

  dispose(): void {
    this.stopLoop();
    this.stopVoices();
  }

  private get duration(): Seconds {
    return videoDuration(this.project.videoTrack);
  }

  private clampTime(time: Seconds): Seconds {
    return clamp(time, 0, this.duration);
  }

  // -------------------------------------------------------------------------
  // Boucle de rendu
  // -------------------------------------------------------------------------

  private startLoop(): void {
    const tick = () => {
      if (!this.playing) return;

      const raw = this.clock.now();
      if (raw >= this.duration) {
        // Fin atteinte: on dessine la derniere frame puis on s'arrete.
        this.pausedAt = this.duration;
        this.playing = false;
        this.stopVoices();
        this.renderFrame(this.duration);
        this.callbacks.onTimeUpdate?.(this.duration);
        this.callbacks.onEnded?.();
        return;
      }

      this.renderFrame(raw);
      this.callbacks.onTimeUpdate?.(raw);
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private renderFrame(time: Seconds): void {
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const scene = buildScene(this.project, time, this.cache);
    draw(scene, { ctx, width: this.canvas.width, height: this.canvas.height });
  }

  // -------------------------------------------------------------------------
  // Audio
  // -------------------------------------------------------------------------

  /**
   * Planifie toutes les pistes audio a partir de `from` (temps timeline).
   *
   * `AudioBufferSourceNode.start(when, offset, duration)` est precis a
   * l'echantillon: c'est le seul appel audio de toute la lecture, et c'est ce
   * qui garantit l'absence de derive.
   */
  private scheduleVoices(from: Seconds): void {
    const startAt = this.context.currentTime;

    for (const track of this.project.audioTracks) {
      if (track.muted || track.gain <= 0) continue;

      const buffer = this.audioBuffers.get(track.assetId);
      if (!buffer) continue;

      // `scheduleSegments` est la meme fonction que celle utilisee par le
      // mixage d'export: le montage audio entendu ici est donc, par
      // construction, celui qui sera encode.
      const scheduled = scheduleSegments(track, {
        from,
        until: this.duration,
        sourceDuration: buffer.duration,
      });
      if (scheduled.length === 0) continue;

      // L'enveloppe porte sur toute la piste, pas sur chaque morceau: sinon
      // chaque coupe s'entendrait comme un fondu.
      const intoTrack = Math.max(0, from - track.start);
      const audible = segmentsDuration(trackSegments(track));
      const remaining = Math.min(
        audible - intoTrack,
        this.duration - Math.max(from, track.start),
      );
      if (remaining <= 0) continue;

      /**
       * Conversion d'une DUREE de timeline en duree d'horloge audio.
       *
       * A vitesse 0,5 une seconde de montage occupe deux secondes reelles: tous
       * les instants de planification et les durees de fondu doivent donc etre
       * divises par la vitesse. Sans cela, ralentir l'image laisserait le son
       * a plein regime et le decalage serait immediat.
       */
      const toAudio = (seconds: Seconds) => seconds / this.rate;

      // Une piste qui commence apres la position courante demarre plus tard.
      const when = startAt + toAudio(Math.max(0, track.start - from));

      const gain = this.context.createGain();
      this.applyGainEnvelope(gain, track, when, toAudio(remaining), intoTrack, this.rate);
      gain.connect(this.context.destination);

      for (const segment of scheduled) {
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        // `playbackRate` etire le son lui-meme. La hauteur change avec la
        // vitesse, comme sur une platine: c'est le comportement attendu d'un
        // ralenti de travail, et cela garde le son cale sur l'image.
        source.playbackRate.value = this.rate;
        source.connect(gain);
        // `segment.at` est un temps TIMELINE: on le ramene sur l'horloge audio.
        source.start(
          startAt + toAudio(segment.at - from),
          segment.offset,
          segment.duration,
        );
        this.voices.push({ source, gain });
      }
    }
  }

  /** Applique volume et fondus via l'automation, pas frame par frame. */
  private applyGainEnvelope(
    gain: GainNode,
    track: Project['audioTracks'][number],
    when: number,
    duration: Seconds,
    alreadyElapsed: Seconds,
    /** Vitesse de l'apercu: les fondus s'etirent avec elle. */
    rate = 1,
  ): void {
    const target = track.gain;
    const param = gain.gain;

    // Les durees de fondu sont exprimees en temps de MONTAGE: comme les instants
    // de planification, elles doivent etre ramenees sur l'horloge audio.
    const fadeOut = track.fadeOut / rate;

    // `alreadyElapsed` est aussi un temps de montage: on ramene la soustraction
    // entiere sur l'horloge audio plutot que de convertir les deux termes.
    const fadeInRemaining = Math.max(0, (track.fadeIn - alreadyElapsed) / rate);

    if (fadeInRemaining > 0) {
      // On demarre au niveau deja atteint si la lecture reprend en plein fondu.
      const startLevel = track.fadeIn > 0 ? (alreadyElapsed / track.fadeIn) * target : target;
      param.setValueAtTime(Math.max(0.0001, startLevel), when);
      param.linearRampToValueAtTime(target, when + fadeInRemaining);
    } else {
      param.setValueAtTime(target, when);
    }

    if (track.fadeOut > 0) {
      const fadeOutStart = when + Math.max(0, duration - fadeOut);
      param.setValueAtTime(target, fadeOutStart);
      // On ne descend pas a 0 exactement: `linearRampToValueAtTime` vers 0 est
      // parfois traite comme une discontinuite audible.
      param.linearRampToValueAtTime(0.0001, when + duration);
    }
  }

  private stopVoices(): void {
    // Plusieurs voix partagent un meme `GainNode` (une piste decoupee en
    // segments): on ne le deconnecte donc qu'une fois.
    const gains = new Set<GainNode>();

    for (const voice of this.voices) {
      try {
        voice.source.stop();
      } catch {
        // Deja arrete: sans consequence.
      }
      voice.source.disconnect();
      gains.add(voice.gain);
    }

    for (const gain of gains) gain.disconnect();
    this.voices = [];
  }
}
