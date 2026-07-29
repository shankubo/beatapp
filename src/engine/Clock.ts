/**
 * Horloges de lecture.
 *
 * Regle absolue: le temps de lecture derive de `AudioContext.currentTime`,
 * JAMAIS de `performance.now()` ni d'un cumul de deltas de requestAnimationFrame.
 *
 * Pourquoi: l'horloge audio est cadencee par le materiel audio, et c'est elle
 * qui fait avancer le son. Si l'image suit une autre horloge, les deux derivent
 * — quelques dizaines de millisecondes sur 15 secondes suffisent a ce qu'un
 * montage cale sur le rythme paraisse decale a la fin. rAF ne fait donc que
 * *demander* l'heure et dessiner.
 */

import type { Seconds } from '../domain/types';

export interface Clock {
  now(): Seconds;
}

/**
 * Horloge de lecture temps reel, asservie a l'`AudioContext`.
 *
 * `origin` est la correspondance etablie au demarrage entre le temps du
 * contexte audio et le temps de la timeline. Un seek recree simplement cette
 * correspondance.
 */
export class PlaybackClock implements Clock {
  private originContextTime: number;
  private originTimelineTime: Seconds;

  constructor(
    private readonly context: BaseAudioContext,
    startAt: Seconds = 0,
    private rate = 1,
  ) {
    this.originContextTime = context.currentTime;
    this.originTimelineTime = startAt;
  }

  now(): Seconds {
    const elapsed = this.context.currentTime - this.originContextTime;
    return this.originTimelineTime + elapsed * this.rate;
  }

  /** Reetablit la correspondance: appele a chaque play et a chaque seek. */
  rebase(timelineTime: Seconds, contextTime = this.context.currentTime): void {
    this.originContextTime = contextTime;
    this.originTimelineTime = timelineTime;
  }

  setRate(rate: number): void {
    // On rebase avant de changer la vitesse, sinon le temps deja ecoule serait
    // recalcule avec la nouvelle vitesse.
    this.rebase(this.now());
    this.rate = rate;
  }
}

/**
 * Horloge deterministe pour l'export: le temps avance frame par frame, sans
 * aucun lien avec le temps reel. C'est ce qui rend l'export reproductible et
 * independant de la vitesse de l'appareil.
 */
export class DeterministicClock implements Clock {
  private frame = 0;

  constructor(private readonly fps: number) {}

  now(): Seconds {
    return this.frame / this.fps;
  }

  advance(): void {
    this.frame += 1;
  }

  seekFrame(frame: number): void {
    this.frame = frame;
  }

  get currentFrame(): number {
    return this.frame;
  }
}

/** Horloge figee, utilisee pour le scrub et les rendus de vignettes. */
export class FixedClock implements Clock {
  constructor(private time: Seconds = 0) {}

  now(): Seconds {
    return this.time;
  }

  set(time: Seconds): void {
    this.time = time;
  }
}
