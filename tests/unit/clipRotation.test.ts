import { describe, expect, it } from 'vitest';

import {
  FULL_TURN,
  MAX_CLIP_SCALE,
  MAX_CLIP_TILT,
  QUARTER_TURN,
  clampTransform,
  joinRotation,
  normalizeRotation,
  splitRotation,
} from '@/domain/project';
import { formatDegrees } from '@/lib/format';

describe('normalizeRotation', () => {
  it('ramene toute rotation dans [0, 2PI[', () => {
    for (const value of [0, QUARTER_TURN, FULL_TURN, -QUARTER_TURN, 5 * FULL_TURN]) {
      const result = normalizeRotation(value);
      expect(result, `${value}`).toBeGreaterThanOrEqual(0);
      expect(result, `${value}`).toBeLessThan(FULL_TURN);
    }
  });

  it('rend un tour complet equivalent a zero', () => {
    // Sans cela, quatre quarts de tour dans le meme sens accumuleraient 2PI et
    // seul « reinitialiser » ramenerait a zero, sur une image pourtant identique.
    expect(normalizeRotation(FULL_TURN)).toBeCloseTo(0, 9);
    expect(normalizeRotation(4 * QUARTER_TURN)).toBeCloseTo(0, 9);
  });

  it('retombe sur zero pour une valeur non finie', () => {
    expect(normalizeRotation(Number.NaN)).toBe(0);
    expect(normalizeRotation(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('splitRotation / joinRotation', () => {
  it('fait un aller-retour exact sur toutes les combinaisons', () => {
    /*
      C'est LE test qui compte: l'interface expose deux reglages (quarts de tour
      et inclinaison) alors que le modele n'en stocke qu'un. Si l'aller-retour
      perdait de l'information, un curseur sauterait sous le doigt.
    */
    for (let quarters = 0; quarters < 4; quarters += 1) {
      for (const tilt of [0, 0.1, -0.1, MAX_CLIP_TILT, -MAX_CLIP_TILT, 0.2, -0.25]) {
        const split = splitRotation(joinRotation(quarters, tilt));
        expect(split.quarters, `q=${quarters} t=${tilt}`).toBe(quarters);
        expect(split.tilt, `q=${quarters} t=${tilt}`).toBeCloseTo(tilt, 9);
      }
    }
  });

  it('ne renvoie jamais une inclinaison hors du curseur', () => {
    /*
      Bug attrape par la mesure avant toute interface: replier modulo 4 AVANT de
      choisir le quart le plus proche renvoyait `tilt = +6,18 rad` pour une
      inclinaison de -0,1. Le curseur, borne a +/-0,35, ne pouvait pas la montrer.
    */
    const near = splitRotation(joinRotation(0, -0.1));
    expect(near.tilt).toBeCloseTo(-0.1, 9);

    // Sur tout le domaine, l'inclinaison reste le plus petit ecart possible.
    for (let i = 0; i < 500; i += 1) {
      const rotation = (i / 500) * 4 * FULL_TURN - 2 * FULL_TURN;
      expect(Math.abs(splitRotation(rotation).tilt)).toBeLessThanOrEqual(
        QUARTER_TURN / 2 + 1e-9,
      );
    }
  });

  it('identifie les quarts de tour cardinaux', () => {
    expect(splitRotation(0).quarters).toBe(0);
    expect(splitRotation(QUARTER_TURN).quarters).toBe(1);
    expect(splitRotation(2 * QUARTER_TURN).quarters).toBe(2);
    expect(splitRotation(3 * QUARTER_TURN).quarters).toBe(3);
    // Un quart negatif est le troisieme quart positif: meme image a l'ecran.
    expect(splitRotation(-QUARTER_TURN).quarters).toBe(3);
  });

  it('borne l inclinaison a la construction', () => {
    // Une valeur hors bornes ne doit pas pouvoir entrer dans le modele.
    const split = splitRotation(joinRotation(0, 10));
    expect(split.tilt).toBeCloseTo(MAX_CLIP_TILT, 9);
  });
});

describe('formatDegrees', () => {
  it('colle le symbole au nombre', () => {
    // Contrairement aux unites du systeme international (« 90 s »), le degre ne
    // prend pas d'espace — en francais comme en anglais.
    expect(formatDegrees(90, 'en')).toBe('90°');
    expect(formatDegrees(0, 'fr')).toBe('0°');
  });

  it('arrondit a l entier', () => {
    // Le dixieme de degre n'a aucun sens visuel et ferait vibrer l'affichage
    // sous le doigt pendant un glissement.
    expect(formatDegrees(12.4, 'en')).toBe('12°');
    expect(formatDegrees(-12.6, 'en')).toBe('-13°');
  });

  it('n affiche jamais « -0° »', () => {
    // Une inclinaison ramenee a zero par la gauche produit -0 en flottant.
    expect(formatDegrees(-0, 'en')).toBe('0°');
    expect(formatDegrees(-0.2, 'en')).toBe('0°');
  });

  it('neutralise une valeur non finie', () => {
    expect(formatDegrees(Number.NaN, 'en')).toBe('0°');
  });
});

describe('clampTransform et la rotation', () => {
  const base = { scale: 1, x: 0, y: 0 };

  it('normalise la rotation sans la borner', () => {
    // Toutes les orientations sont legitimes, contrairement a un zoom de 800 %.
    expect(clampTransform({ ...base, rotation: FULL_TURN + 0.5 }).rotation).toBeCloseTo(
      0.5,
      9,
    );
    expect(clampTransform({ ...base, rotation: -QUARTER_TURN }).rotation).toBeCloseTo(
      3 * QUARTER_TURN,
      9,
    );
  });

  it('neutralise une rotation invalide', () => {
    // Un NaN propage jusqu'a `ctx.rotate` ferait disparaitre l'image.
    expect(clampTransform({ ...base, rotation: Number.NaN }).rotation).toBe(0);
  });

  it('laisse les autres champs se faire borner comme avant', () => {
    // Les bornes sont lues et non recopiees: ce test verifie que le bornage
    // AGIT, pas que la valeur vaut tel chiffre. Recopier 2,5 le faisait echouer
    // au premier relevement du plafond, alors que le bornage marchait toujours.
    const out = clampTransform({ scale: 99, x: 5, y: -5, rotation: 0 });
    expect(out.scale).toBeLessThanOrEqual(MAX_CLIP_SCALE);
    expect(Math.abs(out.x)).toBeLessThanOrEqual(0.4);
    expect(Math.abs(out.y)).toBeLessThanOrEqual(0.4);
  });
});
