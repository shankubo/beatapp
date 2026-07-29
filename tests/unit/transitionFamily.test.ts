import { describe, expect, it } from 'vitest';

import {
  directionsFor,
  familyOf,
  isDirectional,
  transitionTypeFor,
  TRANSITION_DIRECTIONS,
  type TransitionFamily,
} from '@/domain/transitionFamily';
import { incomingState } from '@/engine/transitions';
import type { TransitionType } from '@/domain/types';

/*
  Liste ecrite EN DUR, comme celle de `transitions.test.ts` et pour la meme
  raison: derivee du type, elle couvrirait automatiquement toute nouvelle
  transition — donc sans rien verifier. Ecrite a la main, elle force a ranger
  chaque ajout dans une famille.
*/
const ALL_TYPES: readonly TransitionType[] = [
  'none',
  'fade',
  'blurFade',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'pushLeft',
  'pushRight',
  'wipeLeft',
  'paperSlideLeft',
  'paperSlideRight',
  'paperSlideUp',
  'paperSlideDown',
  'zoomIn',
  'iris',
  'shutter',
  'whipPan',
  'shake',
  'glitch',
  'flash',
];

const ALL_FAMILIES: readonly TransitionFamily[] = [
  'none',
  'fade',
  'blurFade',
  'slide',
  'push',
  'wipeLeft',
  'paperSlide',
  'zoomIn',
  'iris',
  'shutter',
  'whipPan',
  'shake',
  'glitch',
  'flash',
];

describe('familles de transitions', () => {
  it('range chaque type dans une famille qui le reconstruit', () => {
    /*
      L'aller-retour est LE contrat du module: le panneau lit le type enregistre
      pour allumer un bouton, puis reconstruit un type au clic. Si les deux sens
      divergeaient, selectionner une transition en changerait silencieusement le
      sens — un defaut qu'on ne verrait qu'a la lecture.
    */
    for (const type of ALL_TYPES) {
      const { family, direction } = familyOf(type);
      expect(transitionTypeFor(family, direction), type).toBe(type);
    }
  });

  it('couvre tous les types par les familles annoncees', () => {
    // Un type oublie n'apparaitrait dans AUCUN bouton: il deviendrait
    // inaccessible sans que rien ne signale sa disparition.
    const reachable = new Set<TransitionType>();
    for (const family of ALL_FAMILIES) {
      const directions = directionsFor(family);
      if (directions.length === 0) {
        reachable.add(transitionTypeFor(family, 'left'));
        continue;
      }
      for (const direction of directions) reachable.add(transitionTypeFor(family, direction));
    }
    expect([...reachable].sort()).toEqual([...ALL_TYPES].sort());
  });

  it('ne produit jamais un type inexistant', () => {
    /*
      On demande les QUATRE sens a chaque famille, y compris celles qui n'en
      proposent que deux. `push` n'a pas de verticale: sans repli, « Poussee ↑ »
      fabriquerait `pushUp`, un type que `incomingState` ne connait pas — la
      transition serait alors silencieusement sans effet.
    */
    for (const family of ALL_FAMILIES) {
      for (const direction of TRANSITION_DIRECTIONS) {
        const type = transitionTypeFor(family, direction);
        expect(ALL_TYPES, `${family} ${direction}`).toContain(type);
        // Verification par l'usage reel: le moteur doit savoir le dessiner.
        expect(() => incomingState(type, 0.5)).not.toThrow();
      }
    }
  });

  it('retombe sur le premier sens quand celui demande n existe pas', () => {
    // Passer de « Glisse haut » a « Poussee » doit donner « Poussee gauche »,
    // et non un etat vide ou un type fabrique.
    expect(transitionTypeFor('push', 'up')).toBe('pushLeft');
    expect(transitionTypeFor('push', 'down')).toBe('pushLeft');
    // Les sens qui existent, eux, sont respectes.
    expect(transitionTypeFor('push', 'right')).toBe('pushRight');
  });

  it('n annonce un choix de sens que pour les familles qui en ont plusieurs', () => {
    for (const family of ALL_FAMILIES) {
      const directions = directionsFor(family);
      expect(isDirectional(family), family).toBe(directions.length > 0);
      // Une famille « directionnelle » a un seul sens serait un bouton inutile:
      // il n'y aurait rien a choisir.
      if (directions.length > 0) expect(directions.length, family).toBeGreaterThan(1);
    }
  });

  it('ignore le sens pour les familles qui n en proposent pas', () => {
    // `flash` n'a pas de variante: les quatre sens doivent donner le meme type,
    // sinon la rangee de sens changerait quelque chose sans le montrer.
    for (const family of ALL_FAMILIES) {
      if (isDirectional(family)) continue;
      const types = TRANSITION_DIRECTIONS.map((d) => transitionTypeFor(family, d));
      expect(new Set(types).size, family).toBe(1);
    }
  });
});
