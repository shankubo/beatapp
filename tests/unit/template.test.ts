import { describe, expect, it } from 'vitest';

import { applyTemplate, planTemplate, templateCutMarks } from '@/domain/template';
import { createEmptyProject } from '@/domain/project';
import { ripple, videoDuration } from '@/domain/timeline';
import { TEMPLATES } from '@/features/samples/templates';
import { findGeneratedSample } from '@/features/samples/sampleGen';
import type { Template } from '@/domain/template';
import type { Clip, Project } from '@/domain/types';

const FPS = 30;

function clip(id: string, duration = 2, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    assetId: `asset_${id}`,
    start: 0,
    duration,
    fit: 'cover',
    transform: { scale: 1, x: 0, y: 0, rotation: 0 },
    muted: false,
    ...extra,
  };
}

function projectWith(clipCount: number, extra: Partial<Clip> = {}): Project {
  const base = createEmptyProject('Test');
  const clips = Array.from({ length: clipCount }, (_, i) => clip(`c${i}`, 2, extra));
  return { ...base, videoTrack: { ...base.videoTrack, clips: ripple(clips, FPS) } };
}

/** Grille reguliere, en temps timeline. */
function grid(step: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => i * step);
}

const SLIDESHOW = TEMPLATES.find((t) => t.id === 'beat-slideshow')!;
const CINEMATIC = TEMPLATES.find((t) => t.id === 'cinematic-travel')!;
const QUICK = TEMPLATES.find((t) => t.id === 'quick-cuts')!;

const NO_GRID = { grid: [], fps: FPS };

describe('applyTemplate — cadence', () => {
  /*
    Tolerance d'une demi-frame, et non une egalite exacte.

    1,875 s n'est pas un multiple de 1/30: `ripple` aligne toute duree sur la
    grille de frames, donc chaque plan tombe a 1,8667 s. Exiger la valeur ideale
    ferait echouer un calcul pourtant juste — c'est l'arrondi qui est correct,
    une duree non alignee sur une frame n'etant pas representable.
  */
  const HALF_FRAME = 0.5 / FPS;

  it('repartit la duree cible sans analyse rythmique', () => {
    const out = applyTemplate(projectWith(8), SLIDESHOW, NO_GRID);
    for (const c of out.videoTrack.clips) {
      expect(Math.abs(c.duration - SLIDESHOW.targetDuration / 8)).toBeLessThanOrEqual(
        HALF_FRAME,
      );
    }
  });

  it('vise la duree cible meme avec un nombre de plans inattendu', () => {
    /*
      Avec 4 photos pour un modele qui en attend 8, s'en tenir a
      `fallbackClipDuration` produirait un reel deux fois trop court. C'est la
      duree CIBLE qui commande.
    */
    const out = applyTemplate(projectWith(4), SLIDESHOW, NO_GRID);
    // 4 plans arrondis, donc jusqu'a 4 demi-frames d'ecart cumule.
    expect(
      Math.abs(videoDuration(out.videoTrack) - SLIDESHOW.targetDuration),
    ).toBeLessThanOrEqual(4 * HALF_FRAME);
  });

  it('pose les coupes sur un point de grille sur N', () => {
    // `everyN: 2` sur une grille au demi-seconde => un plan toutes les 1 s.
    const out = applyTemplate(projectWith(4), SLIDESHOW, { grid: grid(0.5, 40), fps: FPS });
    for (const c of out.videoTrack.clips.slice(0, -1)) {
      expect(c.duration).toBeCloseTo(1, 2);
    }
  });

  it('ancre la piste a zero', () => {
    // Invariant repris de `distributeClipsOnBeats`: un decalage se traduirait
    // en frames noires en tete d'export.
    const out = applyTemplate(projectWith(4), SLIDESHOW, { grid: grid(0.5, 40), fps: FPS });
    expect(out.videoTrack.clips[0]!.start).toBe(0);
  });
});

describe('applyTemplate — transitions et zoom', () => {
  it('ne pose jamais de transition sur le premier plan', () => {
    const out = applyTemplate(projectWith(4), SLIDESHOW, NO_GRID);
    expect(out.videoTrack.clips[0]!.transitionIn).toBeUndefined();
    for (const c of out.videoTrack.clips.slice(1)) {
      expect(c.transitionIn?.type).toBe(SLIDESHOW.transition.type);
    }
  });

  it("n'ecrit aucune transition pour un modele en coupe franche", () => {
    const out = applyTemplate(projectWith(4), QUICK, NO_GRID);
    for (const c of out.videoTrack.clips) {
      expect(c.transitionIn).toBeUndefined();
    }
  });

  it('efface le zoom lent laisse par un modele precedent', () => {
    /*
      Le defaut que ce test empeche: enchainer « Coupes rapides » apres
      « Voyage cinematique » laissait le zoom en place. Un modele doit
      s'APPLIQUER, pas se superposer.
    */
    const withZoom = applyTemplate(projectWith(4), CINEMATIC, NO_GRID);
    expect(withZoom.videoTrack.clips[0]!.kenBurns).toBeDefined();

    const cleared = applyTemplate(withZoom, QUICK, NO_GRID);
    for (const c of cleared.videoTrack.clips) {
      expect(c.kenBurns).toBeUndefined();
    }
  });
});

describe('applyTemplate — robustesse', () => {
  it('laisse passer un projet sans plan, sans lever', () => {
    // C'est le chemin « demarrer avec ce modele »: les reglages sont poses
    // avant l'import des photos.
    const empty = createEmptyProject('Vide');
    const out = applyTemplate(empty, SLIDESHOW, NO_GRID);
    expect(out.videoTrack.clips).toHaveLength(0);
    expect(out.snapping.division).toBe(SLIDESHOW.division);
    expect(out.snapping.enabled).toBe(true);
  });

  it('ne mute pas le projet fourni', () => {
    const before = projectWith(4);
    const snapshot = JSON.stringify(before);
    applyTemplate(before, CINEMATIC, NO_GRID);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('aligne le snapping sur la division du modele', () => {
    for (const template of TEMPLATES) {
      const out = applyTemplate(projectWith(4), template, NO_GRID);
      expect(out.snapping.division, template.id).toBe(template.division);
    }
  });
});

describe('planTemplate', () => {
  it('signale un montage trop court ou trop fourni', () => {
    // Bornes: moitie moins / deux fois plus que le nombre recommande.
    const few = planTemplate(projectWith(2), QUICK, NO_GRID);
    expect(few.clipMismatch).toBe('tooFew');

    const many = planTemplate(projectWith(40), QUICK, NO_GRID);
    expect(many.clipMismatch).toBe('tooMany');

    const ok = planTemplate(projectWith(QUICK.suggestedClips), QUICK, NO_GRID);
    expect(ok.clipMismatch).toBe('ok');
  });

  it("n'annonce le calage rythmique que si une grille existe", () => {
    expect(planTemplate(projectWith(4), SLIDESHOW, NO_GRID).onBeat).toBe(false);
    expect(
      planTemplate(projectWith(4), SLIDESHOW, { grid: grid(0.5, 40), fps: FPS }).onBeat,
    ).toBe(true);
  });

  it('annonce la duree que le montage aura reellement', () => {
    const plan = planTemplate(projectWith(8), SLIDESHOW, NO_GRID);
    const applied = applyTemplate(projectWith(8), SLIDESHOW, NO_GRID);
    expect(plan.resultingDuration).toBeCloseTo(videoDuration(applied.videoTrack), 6);
  });
});

describe('templateCutMarks', () => {
  it('rend des bornes strictement croissantes dans ]0, 1[', () => {
    for (const template of TEMPLATES) {
      const marks = templateCutMarks(template);
      for (const mark of marks) {
        expect(mark, template.id).toBeGreaterThan(0);
        expect(mark, template.id).toBeLessThan(1);
      }
      for (let i = 1; i < marks.length; i += 1) {
        expect(marks[i]!, template.id).toBeGreaterThan(marks[i - 1]!);
      }
    }
  });

  it('rend une coupe de moins que de plans', () => {
    // Ce sont des JOINTURES: 8 plans font 7 coupes internes.
    for (const template of TEMPLATES) {
      expect(templateCutMarks(template), template.id).toHaveLength(
        template.suggestedClips - 1,
      );
    }
  });
});

describe('catalogue', () => {
  it('ne reference que des boucles existantes', () => {
    // Une faute de frappe produirait sinon un silence a l'execution: la musique
    // assortie ne serait jamais posee, sans aucune erreur.
    for (const template of TEMPLATES) {
      if (!template.suggestedSampleId) continue;
      expect(
        findGeneratedSample(template.suggestedSampleId),
        `${template.id} -> ${template.suggestedSampleId}`,
      ).toBeDefined();
    }
  });

  it('porte des identifiants uniques', () => {
    const ids = new Set(TEMPLATES.map((t: Template) => t.id));
    expect(ids.size).toBe(TEMPLATES.length);
  });
});
