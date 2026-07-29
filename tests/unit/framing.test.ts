import { describe, expect, it } from 'vitest';

import { framingOf } from '@/domain/framing';
import { fitRect } from '@/engine/Compositor';
import type { Clip } from '@/domain/types';

const REEL = { width: 1080, height: 1920 };

function clip(patch: Partial<Clip['transform']> = {}, fit: Clip['fit'] = 'cover') {
  return { fit, transform: { scale: 1, x: 0, y: 0, rotation: 0, ...patch } };
}

describe('framingOf — accord avec le compositeur', () => {
  it('reproduit exactement la geometrie de fitRect', () => {
    /*
      Le repere ne vaut que s'il decrit ce que le compositeur dessine REELLEMENT.
      On compare donc les deux calculs sur les memes entrees: une divergence ici
      afficherait un cadre qui ment.
    */
    for (const source of [
      { width: 3456, height: 5184 },
      { width: 4000, height: 3000 },
      { width: 1080, height: 1920 },
      { width: 2000, height: 2000 },
    ]) {
      for (const fit of ['cover', 'contain'] as const) {
        const info = framingOf(clip({}, fit), source, REEL);
        const rect = fitRect(source.width, source.height, REEL.width, REEL.height, fit);

        const label = `${source.width}x${source.height} ${fit}`;
        expect(info.content.width * REEL.width, `${label} largeur`).toBeCloseTo(rect.width, 3);
        expect(info.content.height * REEL.height, `${label} hauteur`).toBeCloseTo(rect.height, 3);
        expect(info.content.x * REEL.width, `${label} x`).toBeCloseTo(rect.x, 3);
        expect(info.content.y * REEL.height, `${label} y`).toBeCloseTo(rect.y, 3);
      }
    }
  });
});

describe('framingOf — debordement et vide', () => {
  it('signale le debordement d un cover 2:3 en 9:16', () => {
    // Mesure: dessine en 1280x1920, il deborde de 200 px en largeur.
    const info = framingOf(clip(), { width: 3456, height: 5184 }, REEL);
    expect(info.overflows).toBe(true);
    expect(info.underfills).toBe(false);
    expect(info.coverage).toBeCloseTo(1, 3);
  });

  it('signale le vide d un contain paysage', () => {
    // 4000x3000 en contain: 1080x810, donc 1110 px de vide vertical.
    const info = framingOf(clip({}, 'contain'), { width: 4000, height: 3000 }, REEL);
    expect(info.underfills).toBe(true);
    expect(info.overflows).toBe(false);
    expect(info.coverage).toBeLessThan(0.5);
  });

  it('ne signale RIEN quand le plan epouse le cadre', () => {
    // Le cas le plus frequent: aucun repere ne doit s'afficher, sinon l'alerte
    // devient un decor permanent qu'on cesse de voir.
    const info = framingOf(clip(), { width: 1080, height: 1920 }, REEL);
    expect(info.overflows).toBe(false);
    expect(info.underfills).toBe(false);
    expect(info.coverage).toBeCloseTo(1, 6);
  });

  it('detecte le vide cree par un dezoom', () => {
    const info = framingOf(clip({ scale: 0.6 }), { width: 1080, height: 1920 }, REEL);
    expect(info.underfills).toBe(true);
    expect(info.coverage).toBeCloseTo(0.36, 2);
  });

  it('detecte le debordement cree par un zoom', () => {
    const info = framingOf(clip({ scale: 1.5 }), { width: 1080, height: 1920 }, REEL);
    expect(info.overflows).toBe(true);
    expect(info.coverage).toBeCloseTo(1, 3);
  });

  it('suit un decalage lateral', () => {
    const info = framingOf(clip({ x: 0.2 }), { width: 1080, height: 1920 }, REEL);
    expect(info.content.x).toBeCloseTo(0.2, 6);
    // Decale sans zoom: une bande sort a droite, une autre se vide a gauche.
    expect(info.overflows).toBe(true);
    expect(info.underfills).toBe(true);
    expect(info.coverage).toBeCloseTo(0.8, 2);
  });
});

describe('framingOf — quarts de tour', () => {
  it('echange les cotes sur un quart de tour impair', () => {
    const droit = framingOf(clip({}, 'contain'), { width: 4000, height: 3000 }, REEL);
    const tourne = framingOf(clip({}, 'contain'), { width: 4000, height: 3000 }, REEL, 1);
    // Tournee, la source 4:3 devient 3:4 et remplit bien mieux un cadre 9:16.
    expect(tourne.coverage).toBeGreaterThan(droit.coverage);
  });

  it('traite un demi-tour comme l orientation d origine', () => {
    const droit = framingOf(clip(), { width: 4000, height: 3000 }, REEL);
    const demi = framingOf(clip(), { width: 4000, height: 3000 }, REEL, 2);
    expect(demi.coverage).toBeCloseTo(droit.coverage, 6);
  });

  it('accepte un nombre de quarts negatif', () => {
    const a = framingOf(clip(), { width: 4000, height: 3000 }, REEL, 1);
    const b = framingOf(clip(), { width: 4000, height: 3000 }, REEL, -1);
    expect(b.coverage).toBeCloseTo(a.coverage, 6);
  });
});

describe('framingOf — cas degeneres', () => {
  it('suppose le cadre plein sans dimensions de source', () => {
    // Un media non encore sonde ne doit pas declencher de fausse alerte.
    const info = framingOf(clip(), undefined, REEL);
    expect(info.overflows).toBe(false);
    expect(info.underfills).toBe(false);
    expect(info.coverage).toBe(1);
  });

  it('ne divise pas par zero', () => {
    expect(framingOf(clip(), { width: 0, height: 0 }, REEL).coverage).toBe(1);
    expect(framingOf(clip(), { width: 100, height: 100 }, { width: 0, height: 0 }).coverage).toBe(1);
  });

  it('ne renvoie jamais une couverture hors de [0, 1]', () => {
    for (const scale of [0.2, 1, 2.5]) {
      for (const offset of [-0.4, 0, 0.4]) {
        const info = framingOf(clip({ scale, x: offset, y: offset }), { width: 3000, height: 4000 }, REEL);
        expect(info.coverage).toBeGreaterThanOrEqual(0);
        expect(info.coverage).toBeLessThanOrEqual(1);
      }
    }
  });
});
