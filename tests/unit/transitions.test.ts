import { describe, expect, it } from 'vitest';

import {
  composeTransition,
  incomingState,
  needsOutgoingFrame,
  outgoingState,
  transitionStateFor,
} from '@/engine/transitions';
import { TRANSITION_ACCENTS, type TransitionType } from '@/domain/types';

/*
  La liste est ecrite EN DUR et non derivee du type.

  C'est deliberé: un type ne peut pas etre enumere a l'execution, et surtout ce
  test doit echouer quand on ajoute une transition sans la couvrir. Une liste
  derivee la couvrirait automatiquement — donc sans rien verifier.
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

/** Les quatre sens du glissement de calque, qui partagent tous leurs invariants. */
const PAPER_SLIDES: readonly TransitionType[] = [
  'paperSlideLeft',
  'paperSlideRight',
  'paperSlideUp',
  'paperSlideDown',
];

/** Progressions echantillonnees, bornes comprises. */
const SAMPLES = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];

describe('transitions — invariants sur tous les types', () => {
  it('ne produit jamais de valeur non finie', () => {
    /*
      Un NaN traverse `ctx.translate` ou `ctx.scale` sans lever d'erreur et fait
      simplement disparaitre l'image: c'est le genre de defaut qu'on ne voit
      qu'a l'export, une fois le fichier produit.
    */
    for (const type of ALL_TYPES) {
      for (const t of SAMPLES) {
        for (const state of [incomingState(type, t), outgoingState(type, t)]) {
          const label = `${type} @ ${t}`;
          expect(Number.isFinite(state.opacity), label).toBe(true);
          expect(Number.isFinite(state.translateX), label).toBe(true);
          expect(Number.isFinite(state.translateY), label).toBe(true);
          expect(Number.isFinite(state.scale), label).toBe(true);
          expect(Number.isFinite(state.flash), label).toBe(true);
          expect(Number.isFinite(state.rotate), label).toBe(true);
          expect(Number.isFinite(state.blur), label).toBe(true);
          if (state.mask) expect(Number.isFinite(state.mask.amount), label).toBe(true);
          if (state.overlay) {
            // Un `progress` non fini ferait un `fillRect` silencieusement
            // ignore: le voile disparaitrait sans qu'aucune erreur ne soit levee.
            expect(Number.isFinite(state.overlay.progress), label).toBe(true);
            expect(Number.isFinite(state.overlay.opacity), label).toBe(true);
            expect(Number.isFinite(state.overlay.lineWidth), label).toBe(true);
            expect(Number.isFinite(state.overlay.lineOpacity), label).toBe(true);
          }
        }
      }
    }
  });

  it('garde opacite, flash et masque dans [0, 1]', () => {
    for (const type of ALL_TYPES) {
      for (const t of SAMPLES) {
        for (const state of [incomingState(type, t), outgoingState(type, t)]) {
          const label = `${type} @ ${t}`;
          expect(state.opacity, label).toBeGreaterThanOrEqual(0);
          expect(state.opacity, label).toBeLessThanOrEqual(1);
          expect(state.flash, label).toBeGreaterThanOrEqual(0);
          expect(state.flash, label).toBeLessThanOrEqual(1);
          if (state.mask) {
            expect(state.mask.amount, label).toBeGreaterThanOrEqual(0);
            expect(state.mask.amount, label).toBeLessThanOrEqual(1);
          }
          if (state.overlay) {
            for (const [name, value] of [
              ['progress', state.overlay.progress],
              ['opacity', state.overlay.opacity],
              ['lineOpacity', state.overlay.lineOpacity],
            ] as const) {
              expect(value, `${label} — ${name}`).toBeGreaterThanOrEqual(0);
              expect(value, `${label} — ${name}`).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
  });

  it('ne renvoie jamais une echelle nulle ou negative', () => {
    // `ctx.scale(0)` rend la matrice non inversible: plus rien ne se dessine, et
    // une echelle negative retournerait l'image comme un miroir.
    for (const type of ALL_TYPES) {
      for (const t of SAMPLES) {
        expect(incomingState(type, t).scale, `${type} @ ${t}`).toBeGreaterThan(0);
        expect(outgoingState(type, t).scale, `${type} @ ${t}`).toBeGreaterThan(0);
      }
    }
  });

  it('termine sur un etat neutre pour le clip entrant', () => {
    /*
      A t = 1 la transition est finie: le plan entrant doit etre pleinement
      visible et sans deformation residuelle. Sans cet invariant, un plan
      resterait legerement decale ou transparent pendant toute sa duree.
    */
    for (const type of ALL_TYPES) {
      const state = incomingState(type, 1);
      expect(state.opacity, type).toBeCloseTo(1, 6);
      expect(state.translateX, type).toBeCloseTo(0, 6);
      expect(state.translateY, type).toBeCloseTo(0, 6);
      expect(state.scale, type).toBeCloseTo(1, 6);
      expect(state.flash, type).toBeCloseTo(0, 6);
      expect(state.rotate, type).toBeCloseTo(0, 6);
      expect(state.blur, type).toBeCloseTo(0, 6);
      // Un masque doit etre entierement OUVERT, sinon il rognerait le plan.
      if (state.mask) expect(state.mask.amount, type).toBeCloseTo(1, 6);
      /*
        Un voile doit etre entierement SORTI du cadre (`edge` = 1) et son trait
        eteint. Un voile a moitie sorti resterait pose sur le plan pendant toute
        sa duree, bien apres la fin de la transition — exactement le defaut que
        cet invariant a deja attrape sur `glitch`.
      */
      if (state.overlay) {
        expect(state.overlay.progress, type).toBeCloseTo(1, 6);
        expect(state.overlay.lineOpacity, type).toBeCloseTo(0, 6);
      }
    }
  });

  it('est deterministe — l export doit refaire exactement l apercu', () => {
    /*
      `glitch` utilise un pseudo-aleatoire: s'il tirait un vrai `Math.random`,
      l'export ne correspondrait pas a ce que l'utilisateur a vu, ce qui
      violerait la regle de la voie de rendu unique.
    */
    for (const type of ALL_TYPES) {
      for (const t of SAMPLES) {
        expect(incomingState(type, t), `${type} @ ${t}`).toEqual(incomingState(type, t));
        expect(outgoingState(type, t), `${type} @ ${t}`).toEqual(outgoingState(type, t));
      }
    }
  });
});

describe('transitions — comportements specifiques', () => {
  it('ferme completement l obturateur au point de bascule', () => {
    // A mi-parcours, les volets sont joints: c'est ce noir total qui fait lire
    // l'effet comme un obturateur plutot que comme un simple volet.
    for (const type of ['shutter', 'iris'] as const) {
      expect(outgoingState(type, 0.5).mask?.amount, type).toBeCloseTo(0, 6);
      expect(incomingState(type, 0.5).mask?.amount, type).toBeCloseTo(0, 6);
    }
  });

  it('ouvre l obturateur en partant de l etat ferme', () => {
    for (const type of ['shutter', 'iris'] as const) {
      // Debut: le sortant est encore entierement visible.
      expect(outgoingState(type, 0).mask?.amount, type).toBeCloseTo(1, 6);
      // Fin: l'entrant l'est a son tour.
      expect(incomingState(type, 1).mask?.amount, type).toBeCloseTo(1, 6);
    }
  });

  it('amortit le tremblement au lieu de le couper net', () => {
    /*
      L'amplitude doit DECROITRE: une secousse constante puis interrompue se lit
      comme un defaut d'affichage, alors qu'amortie elle se lit comme un impact.
      On compare des enveloppes et non des valeurs instantanees, le signal etant
      oscillant.
    */
    const envelope = (t: number) => {
      const s = incomingState('shake', t);
      return Math.hypot(s.translateX, s.translateY) + Math.abs(s.rotate);
    };
    // Enveloppe maximale sur chaque tiers de la transition.
    const peak = (from: number, to: number) => {
      let max = 0;
      for (let t = from; t <= to; t += 0.005) max = Math.max(max, envelope(t));
      return max;
    };
    expect(peak(0, 0.33)).toBeGreaterThan(peak(0.67, 1));
    expect(envelope(1)).toBeCloseTo(0, 6);
  });

  it('demande le plan sortant sauf quand l ecran est entierement couvert', () => {
    for (const type of ALL_TYPES) {
      const expected = type !== 'none' && type !== 'flash' && !PAPER_SLIDES.includes(type);
      expect(needsOutgoingFrame(type), type).toBe(expected);
    }
  });

  it('decouvre le plan par le passage du calque, jamais par l opacite', () => {
    /*
      Le coeur des glissements de calque: le plan entrant est opaque DES LE DEBUT
      et c'est le voile qui se retire. S'il montait en opacite a la place, le
      fond du projet transparaitrait sous une image a demi effacee — on verrait
      un fondu et non un calque qui glisse.
    */
    for (const type of PAPER_SLIDES) {
      for (const t of SAMPLES) {
        expect(incomingState(type, t).opacity, `${type} @ ${t}`).toBeCloseTo(1, 6);
      }
    }
  });

  it('fait sortir le calque sans jamais revenir en arriere', () => {
    /*
      `progress` doit croitre STRICTEMENT de 0 a 1, dans les quatre sens. Un
      retour en arriere, meme d'une frame, se lit comme un a-coup — c'est
      exactement ce que la consigne « mouvement fluide » exclut.
    */
    for (const type of PAPER_SLIDES) {
      const first = incomingState(type, 0).overlay;
      expect(first?.progress, type).toBeCloseTo(0, 6);
      // A t = 0 le voile couvre TOUTE la frame: c'est le point de depart decrit,
      // « l'image suivante couverte par un blanc transparent ».
      expect(first?.opacity, type).toBeCloseTo(0.5, 6);

      let previous = -1;
      for (let t = 0; t <= 1; t += 0.01) {
        const progress = incomingState(type, t).overlay?.progress ?? -1;
        expect(progress, `${type} @ ${t.toFixed(2)}`).toBeGreaterThan(previous);
        previous = progress;
      }
    }
  });

  it('laisse le calque devancer le plan qu il decouvre', () => {
    /*
      Parallaxe: le voile doit parcourir la frame plus vite que le plan, sinon il
      cesse de passer DEVANT l'image et l'effet se confond avec un glissement
      blanchi. On compare deux fractions de frame parcourues, sur l'axe que le
      sens fait bouger.
    */
    for (const type of PAPER_SLIDES) {
      for (const t of [0.25, 0.5, 0.75]) {
        const state = incomingState(type, t);
        const panelTravel = state.overlay?.progress ?? 0;
        // Le plan part de PAPER_DRIFT (0,125) et rejoint 0: son trajet parcouru
        // est le complement de son decalage restant, quel que soit le signe.
        const remaining = Math.hypot(state.translateX, state.translateY);
        expect(panelTravel, `${type} @ ${t}`).toBeGreaterThan(0.125 - remaining);
      }
    }
  });

  it('porte le sens dans la direction et jamais dans le nombre', () => {
    /*
      Les quatre sens doivent partager exactement la meme courbe: seule
      `direction` les distingue. Si l'un d'eux inversait son `progress` pour
      exprimer son sens, le compositeur devrait connaitre deux conventions — et
      l'invariant d'etat neutre a t = 1 ne tiendrait plus pour ce sens la.
    */
    for (const t of SAMPLES) {
      const reference = incomingState('paperSlideLeft', t).overlay?.progress;
      for (const type of PAPER_SLIDES) {
        expect(incomingState(type, t).overlay?.progress, `${type} @ ${t}`).toBeCloseTo(
          reference ?? -1,
          6,
        );
      }
    }
    // Chaque type porte bien SA direction, sans quoi la grille proposerait
    // quatre boutons produisant le meme mouvement.
    const directions = PAPER_SLIDES.map((type) => incomingState(type, 0.5).overlay?.direction);
    expect(new Set(directions).size).toBe(PAPER_SLIDES.length);
  });

  it('fait deriver le plan sur le seul axe du glissement', () => {
    /*
      Un sens horizontal ne doit pas bouger l'image verticalement, et
      reciproquement: la parallaxe accompagne le voile, elle ne part pas en
      diagonale.
    */
    for (const t of [0.25, 0.5, 0.75]) {
      for (const type of ['paperSlideLeft', 'paperSlideRight'] as const) {
        expect(incomingState(type, t).translateY, `${type} @ ${t}`).toBeCloseTo(0, 6);
      }
      for (const type of ['paperSlideUp', 'paperSlideDown'] as const) {
        expect(incomingState(type, t).translateX, `${type} @ ${t}`).toBeCloseTo(0, 6);
      }
      // Les paires opposees derivent en sens inverse, comme les `slide`.
      expect(Math.sign(incomingState('paperSlideLeft', t).translateX)).toBe(
        -Math.sign(incomingState('paperSlideRight', t).translateX),
      );
      expect(Math.sign(incomingState('paperSlideUp', t).translateY)).toBe(
        -Math.sign(incomingState('paperSlideDown', t).translateY),
      );
    }
  });

  it('cache le plan sortant sous le calque', () => {
    // Le plan entrant etant opaque et plein cadre, rien du precedent ne peut
    // transparaitre: le dessiner serait du travail perdu a chaque frame.
    for (const type of PAPER_SLIDES) {
      for (const t of SAMPLES) {
        expect(outgoingState(type, t).opacity, `${type} @ ${t}`).toBeCloseTo(0, 6);
      }
    }
  });

  it('laisse le sortant entier sous le balayage', () => {
    // Le masquer AUSSI ouvrirait une bande de fond entre les deux plans.
    for (const t of SAMPLES) {
      expect(outgoingState('wipeLeft', t).mask, `${t}`).toBeUndefined();
    }
  });

  it('garde les deux plans SOLIDAIRES pendant une poussee', () => {
    /*
      Le coeur de l'effet: le plan entrant colle derriere le sortant et le
      chasse. L'ecart entre les deux doit donc valoir exactement une largeur de
      frame a CHAQUE instant.

      Ce que ce test empeche: qu'on applique un jour deux courbes differentes aux
      deux sens. L'ecart varierait alors, et selon le signe on verrait soit les
      plans se chevaucher, soit une bande de fond s'ouvrir entre eux — un defaut
      subtil, visible seulement en pleine transition.
    */
    for (const [type, gapSign] of [
      // `pushLeft` chasse vers la gauche: le sortant est a GAUCHE de l'entrant,
      // donc l'ecart `sortant - entrant` est negatif. `pushRight` l'inverse.
      ['pushLeft', -1],
      ['pushRight', 1],
    ] as const) {
      for (let t = 0; t <= 1; t += 0.02) {
        const gap = outgoingState(type, t).translateX - incomingState(type, t).translateX;
        expect(gap, `${type} @ ${t.toFixed(2)}`).toBeCloseTo(gapSign, 6);
      }
    }
  });

  it('demarre la poussee plus doucement qu un glissement', () => {
    /*
      La seule difference avec `slideLeft` / `slideRight`, qui couvrent la meme
      geometrie. Mesure a t = 0,10: la sortie cubique a deja parcouru 27 % du
      trajet, la poussee 0,4 %. Sans cet ecart de rythme, la nouvelle entree
      ferait doublon avec l'ancienne.
    */
    const slideProgress = Math.abs(outgoingState('slideRight', 0.1).translateX);
    const pushProgress = Math.abs(outgoingState('pushRight', 0.1).translateX);
    expect(pushProgress).toBeLessThan(slideProgress / 10);
  });

  it('fait glisser les paires opposees en sens inverse', () => {
    // Une paire gauche/droite qui glisserait du meme cote serait un doublon.
    for (const t of [0.25, 0.5, 0.75]) {
      expect(Math.sign(incomingState('slideLeft', t).translateX)).toBe(
        -Math.sign(incomingState('slideRight', t).translateX),
      );
      expect(Math.sign(incomingState('slideUp', t).translateY)).toBe(
        -Math.sign(incomingState('slideDown', t).translateY),
      );
      expect(Math.sign(incomingState('pushLeft', t).translateX)).toBe(
        -Math.sign(incomingState('pushRight', t).translateX),
      );
    }
  });
});

describe('accents enchaines', () => {
  /*
    Le comportement demande: « l'image suivante apparait en tremblant avec le
    calque, puis une fois le tremblement passe le calque se deplace et on voit
    l'image nette ». Les deux effets se SUCCEDENT donc, ils ne se superposent
    pas — c'est toute la difference avec un cumul simultane, ou la secousse
    brouillait le moment meme ou l'image se decouvre.
  */

  /** Part de la duree occupee par l'accent, en miroir de `ACCENT_PHASE`. */
  const PHASE = 1 / 3;

  it('fige le calque pendant toute la phase de tremblement', () => {
    /*
      Le coeur de l'enchainement: tant que l'accent joue, le voile ne bouge pas
      et couvre tout. S'il glissait deja, on aurait de nouveau les deux gestes en
      meme temps.
    */
    for (const t of [0, 0.1, 0.2, 0.3]) {
      const state = transitionStateFor('paperSlideLeft', t, 'incoming', 'shake');
      expect(state.overlay?.progress, `${t}`).toBeCloseTo(0, 6);
    }
  });

  it('secoue pendant la premiere phase et plus apres', () => {
    // Enveloppe du mouvement propre a l'accent, mesuree sur la rotation: le
    // calque seul n'en produit aucune, donc tout ce qu'on lit vient du shake.
    const tilt = (t: number) =>
      Math.abs(transitionStateFor('paperSlideLeft', t, 'incoming', 'shake').rotate);

    const during = Math.max(tilt(0.05), tilt(0.1), tilt(0.15), tilt(0.2), tilt(0.25));
    expect(during).toBeGreaterThan(0);

    // Passe la bascule, plus aucune secousse: le calque part sur une image
    // stable, ce qui est exactement le « on voit l'image nette » demande.
    for (const t of [0.4, 0.5, 0.7, 0.9, 1]) {
      expect(tilt(t), `${t}`).toBeCloseTo(0, 6);
    }
  });

  it('deplace le calque uniquement apres le tremblement', () => {
    /*
      La seconde phase doit couvrir TOUTE la course du voile: il part de 0 a la
      bascule et sort completement a la fin. Un voile qui n'irait qu'a mi-course
      resterait pose sur le plan.
    */
    expect(
      transitionStateFor('paperSlideLeft', PHASE, 'incoming', 'shake').overlay?.progress,
    ).toBeCloseTo(0, 6);
    expect(
      transitionStateFor('paperSlideLeft', 1, 'incoming', 'shake').overlay?.progress,
    ).toBeCloseTo(1, 6);

    // Et il ne recule jamais: un retour en arriere se lit comme un a-coup.
    let previous = -1;
    for (let t = PHASE; t <= 1; t += 0.01) {
      const progress = transitionStateFor('paperSlideLeft', t, 'incoming', 'shake').overlay
        ?.progress;
      expect(progress, `${t.toFixed(2)}`).toBeGreaterThanOrEqual(previous);
      previous = progress ?? -1;
    }
  });

  it('garde le plan entrant opaque pendant les deux phases', () => {
    /*
      Piege mesure: joue seul, `shake` porte son propre fondu d'entree
      (`opacity = t * 3`) et `glitch` un clignotement. S'ils s'appliquaient, le
      plan clignoterait pendant la premiere phase — alors que le calque veut une
      image PLEINE des le debut, l'image se revelant par le passage du voile.
    */
    for (const accent of TRANSITION_ACCENTS) {
      for (const t of SAMPLES) {
        const state = transitionStateFor('paperSlideLeft', t, 'incoming', accent);
        expect(state.opacity, `${accent} @ ${t}`).toBeCloseTo(1, 6);
      }
    }
  });

  it('multiplie les echelles au lieu de les additionner', () => {
    // Les echelles sont des FACTEURS: les additionner ferait doubler l'image
    // des qu'un accent est present.
    const merged = composeTransition(
      { ...incomingState('fade', 0.5), scale: 1.2 },
      { ...incomingState('fade', 0.5), scale: 1.5 },
    );
    expect(merged.scale).toBeCloseTo(1.8, 6);
  });

  it('preserve masque et voile de la transition porteuse', () => {
    // Un seul masque et un seul voile sont dessinables: ceux de la transition
    // font foi. Les accents legitimes n'en portent d'ailleurs aucun.
    for (const accent of TRANSITION_ACCENTS) {
      for (const t of [0.1, 0.2, 0.3]) {
        const state = transitionStateFor('shutter', t, 'incoming', accent);
        expect(state.mask, `${accent} @ ${t}`).toEqual(incomingState('shutter', 0).mask);
      }
    }
  });

  it('n emporte jamais un masque ni un voile depuis l accent', () => {
    /*
      Garde-fou sur la liste elle-meme: si un jour on ajoutait `iris` ou
      `paperSlide` aux accents, son masque serait silencieusement ignore et
      l'utilisateur choisirait un effet sans aucun resultat visible.
    */
    for (const accent of TRANSITION_ACCENTS) {
      for (const t of SAMPLES) {
        expect(incomingState(accent, t).mask, `${accent} @ ${t}`).toBeUndefined();
        expect(incomingState(accent, t).overlay, `${accent} @ ${t}`).toBeUndefined();
      }
    }
  });

  it('revient a la transition seule quand aucun accent n est pose', () => {
    for (const type of ALL_TYPES) {
      for (const t of SAMPLES) {
        expect(transitionStateFor(type, t, 'incoming'), `${type} @ ${t}`).toEqual(
          incomingState(type, t),
        );
        expect(transitionStateFor(type, t, 'outgoing'), `${type} @ ${t}`).toEqual(
          outgoingState(type, t),
        );
      }
    }
  });

  it('termine sur un etat neutre malgre l accent', () => {
    /*
      Meme invariant que sans accent: un plan qui resterait decale ou pivote
      apres la transition le resterait pour TOUTE sa duree. L'enchainement est
      justement l'occasion de le reintroduire — la seconde phase doit atteindre
      sa fin de course exactement a t = 1, et non s'arreter en chemin.
    */
    for (const accent of TRANSITION_ACCENTS) {
      for (const type of ALL_TYPES) {
        const state = transitionStateFor(type, 1, 'incoming', accent);
        const label = `${type} + ${accent}`;
        expect(state.opacity, label).toBeCloseTo(1, 6);
        expect(state.translateX, label).toBeCloseTo(0, 6);
        expect(state.translateY, label).toBeCloseTo(0, 6);
        expect(state.rotate, label).toBeCloseTo(0, 6);
        expect(state.scale, label).toBeCloseTo(1, 6);
        expect(state.flash, label).toBeCloseTo(0, 6);
        if (state.mask) expect(state.mask.amount, label).toBeCloseTo(1, 6);
        if (state.overlay) expect(state.overlay.progress, label).toBeCloseTo(1, 6);
      }
    }
  });

  it('garde des valeurs finies et une echelle exploitable', () => {
    for (const accent of TRANSITION_ACCENTS) {
      for (const type of ALL_TYPES) {
        for (const t of SAMPLES) {
          for (const role of ['incoming', 'outgoing'] as const) {
            const state = transitionStateFor(type, t, role, accent);
            const label = `${type} + ${accent} ${role} @ ${t}`;
            expect(Number.isFinite(state.translateX), label).toBe(true);
            expect(Number.isFinite(state.translateY), label).toBe(true);
            expect(Number.isFinite(state.scale), label).toBe(true);
            // `ctx.scale(0)` rend la matrice non inversible: plus rien ne se
            // dessine. Le produit de deux echelles peut y tomber, pas une seule.
            expect(state.scale, label).toBeGreaterThan(0);
            expect(state.opacity, label).toBeGreaterThanOrEqual(0);
            expect(state.opacity, label).toBeLessThanOrEqual(1);
            expect(state.flash, label).toBeGreaterThanOrEqual(0);
            expect(state.flash, label).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

