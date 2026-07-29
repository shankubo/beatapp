/**
 * Transitions. Module PUR (aucun acces au DOM, seulement des maths).
 *
 * Chaque transition est decrite comme une deformation a appliquer au clip
 * ENTRANT et au clip SORTANT. Le compositeur applique ces valeurs sans savoir
 * de quelle transition il s'agit, ce qui garde `Compositor` court et permet
 * d'ajouter une transition sans le modifier.
 */

import type { TransitionAccent, TransitionType } from '../domain/types';
import { clamp01, easeInOutCubic, easeOutCubic } from '../lib/math';

/**
 * Forme du masque qui decoupe le clip.
 *
 * `amount` va de 0 (ferme, rien de visible) a 1 (ouvert, tout visible). C'est
 * le compositeur qui traduit cette valeur en geometrie, parce que lui seul
 * connait les dimensions reelles de la frame — le module reste ainsi pur.
 */
export type TransitionMask =
  | { kind: 'bars'; amount: number }
  | { kind: 'circle'; amount: number }
  | { kind: 'wipeX'; amount: number };

/**
 * Cote vers lequel un voile s'echappe.
 *
 * C'est la direction du MOUVEMENT, pas celle du bord: `left` decrit un voile qui
 * file vers la gauche et decouvre donc l'image de la gauche vers la droite.
 */
export type OverlayDirection = 'left' | 'right' | 'up' | 'down';

/**
 * Voile pose PAR-DESSUS le clip, apres toutes ses transformations.
 *
 * Distinct de `mask`, qui decoupe: un voile n'enleve rien, il recouvre. La
 * bande de `paperSlide` doit laisser deviner l'image en dessous, ce qu'une
 * decoupe ne peut pas faire — d'ou ce second canal.
 *
 * `progress` est la fraction de course DEJA parcourue par le voile, de 0 (il
 * couvre toute la frame) a 1 (il en est entierement sorti). Il est volontairement
 * independant du sens: c'est `direction` qui dit ou tombe le bord, et le
 * compositeur seul traduit le couple en pixels. Porter le sens dans le nombre
 * lui-meme — un `edge` qui reculerait pour certains sens — obligerait chaque
 * lecteur a se rappeler quelle convention s'applique a quel cas.
 */
export type TransitionOverlay = {
  kind: 'panel';
  direction: OverlayDirection;
  progress: number;
  /** Opacite du voile blanc, dans [0, 1]. */
  opacity: number;
  /** Epaisseur du trait de bord, en fraction de largeur. 0 = pas de trait. */
  lineWidth: number;
  /** Opacite du trait, dans [0, 1]. */
  lineOpacity: number;
};

export interface TransitionState {
  /** Opacite du clip, dans [0, 1]. */
  opacity: number;
  /** Translation en fraction de la largeur / hauteur de frame. */
  translateX: number;
  translateY: number;
  /** Facteur d'echelle multiplicatif. */
  scale: number;
  /** Voile blanc par-dessus, dans [0, 1] — utilise par `flash`. */
  flash: number;
  /** Rotation additionnelle, en radians — utilisee par `shake` et `glitch`. */
  rotate: number;
  /** Flou en fraction de la largeur de frame — utilise par `blurFade`. */
  blur: number;
  /** Decoupe optionnelle. `undefined` = clip entier visible. */
  mask?: TransitionMask;
  /** Voile optionnel par-dessus. `undefined` = rien de pose sur le clip. */
  overlay?: TransitionOverlay;
}

const NEUTRAL: TransitionState = {
  opacity: 1,
  translateX: 0,
  translateY: 0,
  scale: 1,
  flash: 0,
  rotate: 0,
  blur: 0,
};

export function neutralTransition(): TransitionState {
  return { ...NEUTRAL };
}

/*
  Reglages des transitions dynamiques.

  Exprimes en FRACTION de frame (jamais en pixels): un apercu de 390 px et un
  export de 1080 px doivent produire exactement le meme mouvement, comme l'exige
  la regle des unites normalisees.
*/

/** Amplitude du tremblement, en fraction de frame. 0,012 ~ 13 px en 1080. */
const SHAKE_AMPLITUDE = 0.012;
/** Nombre d'oscillations sur la duree de la transition. */
const SHAKE_FREQUENCY = 38;
/** Inclinaison du tremblement, en radians (~0,7 degre). */
const SHAKE_TILT = 0.012;

/**
 * Paliers du glitch.
 *
 * 7 et non une valeur ronde: un nombre premier evite que les sauts ne tombent
 * en phase avec la frequence d'images, ce qui rendrait l'effet regulier — donc
 * lisse, alors qu'on cherche l'irregularite.
 */
const GLITCH_STEPS = 7;
const GLITCH_AMPLITUDE = 0.05;

/** Flou maximal du fondu flou, en fraction de largeur. 0,02 ~ 22 px en 1080. */
const BLUR_FADE_MAX = 0.02;

/*
  Reglages du glissement de calque (`paperSlide`).

  Un voile blanc couvre le nouveau plan, puis file vers la gauche en laissant
  l'image se decouvrir derriere lui. Le trait de bord est ce qui fait lire le
  voile comme un OBJET qui passe plutot que comme un simple fondu blanc: sans
  lui, l'oeil ne suit rien et l'effet se confond avec `flash`.
*/

/** Opacite du voile: la consigne « blanc mais transparent a 50 % ». */
const PAPER_OPACITY = 0.5;
/** Epaisseur du trait de bord, en fraction de largeur. 0,004 ~ 4 px en 1080. */
const PAPER_LINE_WIDTH = 0.004;
/** Opacite du trait: franc sans etre dur, il guide l'oeil sans decouper. */
const PAPER_LINE_OPACITY = 0.9;
/**
 * Debord du plan entrant, en fraction de frame.
 *
 * Le plan ne suit pas le voile a la meme vitesse: il glisse d'un huitieme
 * seulement, ce qui donne un effet de parallaxe. A vitesse egale, le voile
 * cesserait de passer DEVANT l'image et l'ensemble se lirait comme un
 * `slideLeft` blanchi.
 */
const PAPER_DRIFT = 0.125;

/**
 * Etat du clip ENTRANT a la progression `t` (0 = debut de la transition,
 * 1 = transition terminee).
 */
export function incomingState(type: TransitionType, t: number): TransitionState {
  const eased = easeOutCubic(t);
  switch (type) {
    case 'none':
      return NEUTRAL;
    case 'fade':
      return { ...NEUTRAL, opacity: t };
    case 'slideLeft':
      return { ...NEUTRAL, translateX: 1 - eased };
    case 'slideRight':
      return { ...NEUTRAL, translateX: -(1 - eased) };
    case 'slideUp':
      return { ...NEUTRAL, translateY: 1 - eased };
    case 'slideDown':
      return { ...NEUTRAL, translateY: -(1 - eased) };

    /*
      Poussee: le plan entrant colle DERRIERE le sortant et le chasse.

      Le decalage vient d'une seule courbe partagee par les deux sens, ce qui
      maintient un ecart rigoureusement constant d'une largeur de frame: les
      deux plans se deplacent comme une bande unique, sans chevauchement ni
      bande de fond entre eux.

      `easeInOutCubic` et non `easeOutCubic`: c'est toute la difference avec
      `slideRight`, qui couvre la meme geometrie. Mesure a t = 0,10, la sortie
      cubique a deja parcouru 27 % du trajet contre 0,4 % ici — l'une part comme
      un ressort, l'autre se pousse. C'est le rythme d'un carrousel.
    */
    case 'pushLeft':
      return { ...NEUTRAL, translateX: 1 - easeInOutCubic(t) };
    case 'pushRight':
      return { ...NEUTRAL, translateX: easeInOutCubic(t) - 1 };

    case 'zoomIn':
      // Demarre legerement trop grand puis se pose: plus dynamique qu'un zoom avant.
      return { ...NEUTRAL, opacity: t, scale: 1 + 0.18 * (1 - eased) };
    case 'whipPan':
      return { ...NEUTRAL, translateX: (1 - easeInOutCubic(t)) * 0.6, opacity: Math.min(1, t * 2) };
    case 'flash':
      // Le voile s'estompe sur la premiere moitie de la transition.
      return { ...NEUTRAL, flash: Math.max(0, 1 - t * 2) };

    /*
      Obturateur: deux volets qui se REOUVRENT sur le nouveau plan.

      La seconde moitie de la transition seulement. Pendant la premiere, le clip
      sortant finit de fermer les volets — un obturateur qui se rouvrirait avant
      d'etre ferme ne serait plus un obturateur.
    */
    case 'shutter':
      return {
        ...NEUTRAL,
        mask: { kind: 'bars', amount: easeInOutCubic(Math.max(0, t * 2 - 1)) },
      };

    // Iris: le disque s'ouvre depuis le centre. Meme decoupage en deux temps.
    case 'iris':
      return {
        ...NEUTRAL,
        mask: { kind: 'circle', amount: easeOutCubic(Math.max(0, t * 2 - 1)) },
      };

    /*
      Tremblement: la secousse s'AMORTIT au lieu de s'arreter net.

      L'amplitude decroit en (1 - t) et l'oscillation est portee par un sinus a
      frequence fixe. Une secousse constante puis coupee se lit comme un bug
      d'affichage; amortie, elle se lit comme un impact.
    */
    case 'shake': {
      const decay = 1 - easeOutCubic(t);
      return {
        ...NEUTRAL,
        opacity: Math.min(1, t * 3),
        translateX: Math.sin(t * SHAKE_FREQUENCY) * SHAKE_AMPLITUDE * decay,
        translateY: Math.cos(t * SHAKE_FREQUENCY * 1.3) * SHAKE_AMPLITUDE * decay,
        rotate: Math.sin(t * SHAKE_FREQUENCY * 0.7) * SHAKE_TILT * decay,
        // Zoom leger: sans lui, la secousse decouvrirait le fond sur les bords.
        scale: 1 + SHAKE_AMPLITUDE * 2 * decay,
      };
    }

    /*
      Glitch: sauts discrets et non un mouvement continu.

      `Math.floor` quantifie la progression en paliers: c'est ce qui donne le
      caractere numerique. Une interpolation lisse produirait un simple
      tremblement, deja couvert par `shake`.
    */
    case 'glitch': {
      /*
        `t * (STEPS - 1)` et non `t * STEPS`: a t = 1 le second donne le palier 7,
        or 7 % 3 === 1 declenchait le clignotement — le plan restait a 60 %
        d'opacite pour toute sa duree, bien apres la fin de la transition. Un
        test d'etat neutre en fin de transition l'a attrape.
      */
      const step = Math.floor(t * (GLITCH_STEPS - 1));
      const decay = 1 - t;
      // Pseudo-aleatoire DETERMINISTE: l'export doit refaire exactement l'apercu.
      const jitter = ((step * 2654435761) % 1000) / 1000 - 0.5;
      return {
        ...NEUTRAL,
        // Le clignotement s'eteint avec `decay`, donc vaut 1 a t = 1.
        opacity: step % 3 === 1 ? 1 - 0.4 * decay : 1,
        translateX: jitter * GLITCH_AMPLITUDE * decay,
        rotate: jitter * 0.05 * decay,
      };
    }

    // Balayage: le nouveau plan se decouvre de la gauche vers la droite.
    case 'wipeLeft':
      return { ...NEUTRAL, mask: { kind: 'wipeX', amount: easeInOutCubic(t) } };

    // Fondu flou: le plan arrive net en se materialisant depuis le flou.
    case 'blurFade':
      return { ...NEUTRAL, opacity: t, blur: (1 - eased) * BLUR_FADE_MAX };

    /*
      Glissement de calque: le plan entrant est DEJA la, entierement opaque, mais
      recouvert d'un voile blanc a 50 % qui s'echappe sur un cote. L'image se
      revele donc par le passage du voile, et non par une montee d'opacite.

      C'est la raison d'etre du canal `overlay`: en jouant sur `opacity`, le fond
      transparaitrait sous le plan a demi efface au lieu de l'image sous un
      calque. `easeInOutCubic` donne au voile le depart pose et la sortie freinee
      d'un objet qui a une masse — la fluidite tient a cette courbe, pas a la
      duree.

      Les quatre sens partagent cette branche: seule change la direction, que le
      compositeur traduit en geometrie. Les ecrire separement dupliquerait quatre
      fois la parallaxe et l'extinction du trait, avec la derive que cela promet.
    */
    case 'paperSlideLeft':
      return paperSlide(t, 'left');
    case 'paperSlideRight':
      return paperSlide(t, 'right');
    case 'paperSlideUp':
      return paperSlide(t, 'up');
    case 'paperSlideDown':
      return paperSlide(t, 'down');
  }
}

/**
 * Etat entrant commun aux quatre glissements de calque.
 *
 * Le plan derive dans le MEME sens que le voile, mais huit fois moins loin: sans
 * cette parallaxe le voile cesse de passer devant l'image et l'effet se confond
 * avec un glissement blanchi.
 */
function paperSlide(t: number, direction: OverlayDirection): TransitionState {
  const swept = easeInOutCubic(t);
  const drift = (1 - swept) * PAPER_DRIFT;
  // Le plan part du cote OPPOSE a la fuite du voile et rejoint le centre.
  const horizontal = direction === 'left' ? 1 : direction === 'right' ? -1 : 0;
  const vertical = direction === 'up' ? 1 : direction === 'down' ? -1 : 0;

  return {
    ...NEUTRAL,
    translateX: drift * horizontal,
    translateY: drift * vertical,
    /*
      Zoom compensant exactement la derive, comme le fait `shake`.

      Sans lui, un plan decale de 12,5 % DECOUVRE le fond du projet sur un bord.
      Le defaut est le plus visible au debut, ou la derive est maximale, et il le
      devient franchement quand un accent precede le glissement: le plan reste
      alors decale pendant tout le tremblement au lieu de rejoindre le centre en
      quelques frames. Mesure par un test de rendu, qui lisait du noir la ou le
      voile blanc etait attendu.

      Le facteur 2 vient de la geometrie: une translation de `d` (en fraction de
      frame) laisse une bande de `d` d'un cote, qu'un agrandissement doit couvrir
      des DEUX cotes a la fois.
    */
    scale: 1 + drift * 2,
    overlay: {
      kind: 'panel',
      direction,
      progress: swept,
      opacity: PAPER_OPACITY,
      lineWidth: PAPER_LINE_WIDTH,
      /*
        Le trait s'efface sur le dernier quart plutot que de sortir net du cadre.
        A pleine opacite au moment ou il quitte la frame, il accroche l'oeil sur
        le bord — exactement la ou il n'y a plus rien a regarder.
      */
      lineOpacity: PAPER_LINE_OPACITY * clamp01((1 - swept) * 4),
    },
  };
}

/** Etat du clip SORTANT a la progression `t`. */
export function outgoingState(type: TransitionType, t: number): TransitionState {
  const eased = easeOutCubic(t);
  switch (type) {
    case 'none':
      // Coupe franche: le clip sortant disparait immediatement.
      return { ...NEUTRAL, opacity: 0 };
    case 'fade':
      return { ...NEUTRAL, opacity: 1 - t };
    case 'slideLeft':
      return { ...NEUTRAL, translateX: -eased };
    case 'slideRight':
      return { ...NEUTRAL, translateX: eased };
    case 'slideUp':
      return { ...NEUTRAL, translateY: -eased };
    case 'slideDown':
      return { ...NEUTRAL, translateY: eased };

    // Le sortant est CHASSE: meme courbe que l'entrant, decalee d'une frame.
    // Toute divergence de courbe ouvrirait un ecart entre les deux plans.
    case 'pushLeft':
      return { ...NEUTRAL, translateX: -easeInOutCubic(t) };
    case 'pushRight':
      return { ...NEUTRAL, translateX: easeInOutCubic(t) };

    case 'zoomIn':
      return { ...NEUTRAL, opacity: 1 - t, scale: 1 - 0.1 * eased };
    case 'whipPan':
      return { ...NEUTRAL, translateX: -easeInOutCubic(t) * 0.6, opacity: 1 - Math.min(1, t * 2) };
    case 'flash':
      return { ...NEUTRAL, opacity: 1 - Math.min(1, t * 2) };

    // Obturateur: les volets se FERMENT sur la premiere moitie. Voir la note du
    // sens entrant pour le decoupage en deux temps.
    case 'shutter':
      return {
        ...NEUTRAL,
        mask: { kind: 'bars', amount: 1 - easeInOutCubic(Math.min(1, t * 2)) },
      };

    case 'iris':
      return {
        ...NEUTRAL,
        mask: { kind: 'circle', amount: 1 - easeInOutCubic(Math.min(1, t * 2)) },
      };

    case 'shake': {
      const decay = 1 - t;
      return {
        ...NEUTRAL,
        opacity: 1 - Math.min(1, t * 3),
        translateX: Math.sin(t * SHAKE_FREQUENCY) * SHAKE_AMPLITUDE * decay,
        translateY: Math.cos(t * SHAKE_FREQUENCY * 1.3) * SHAKE_AMPLITUDE * decay,
        rotate: Math.sin(t * SHAKE_FREQUENCY * 0.7) * SHAKE_TILT * decay,
        scale: 1 + SHAKE_AMPLITUDE * 2 * decay,
      };
    }

    case 'glitch': {
      // Meme quantification que le sens entrant, pour que les deux plans
      // sautent ensemble plutot que de trembler chacun de son cote.
      const step = Math.floor(t * (GLITCH_STEPS - 1));
      const jitter = ((step * 2654435761) % 1000) / 1000 - 0.5;
      return {
        ...NEUTRAL,
        opacity: 1 - Math.min(1, t * 1.5),
        translateX: jitter * GLITCH_AMPLITUDE,
        rotate: jitter * 0.05,
      };
    }

    /*
      Balayage: le sortant reste ENTIER dessous.

      Il n'est pas masque a son tour — c'est le masque de l'entrant qui le
      recouvre progressivement. Le masquer aussi ouvrirait une bande de fond
      entre les deux plans.
    */
    case 'wipeLeft':
      return NEUTRAL;

    case 'blurFade':
      return { ...NEUTRAL, opacity: 1 - t, blur: eased * BLUR_FADE_MAX };

    /*
      Le sortant est cache des la premiere frame.

      Le plan entrant est opaque et couvre toute la frame — seul le voile blanc
      le nuance. Rien du plan precedent ne peut donc transparaitre, et le laisser
      visible serait du dessin perdu a chaque frame. C'est aussi ce qui permet a
      `needsOutgoingFrame` de repondre `false` et d'economiser un decodage.
    */
    case 'paperSlideLeft':
    case 'paperSlideRight':
    case 'paperSlideUp':
    case 'paperSlideDown':
      return { ...NEUTRAL, opacity: 0 };
  }
}

/**
 * Compose un accent PAR-DESSUS une transition figee.
 *
 * Utilise pendant la phase d'accent de `transitionStateFor`: la transition y est
 * arretee a son premier instant, et l'accent seul bouge. La fonction reste
 * neanmoins une composition generale de deux etats, chaque canal se combinant
 * selon sa nature — et non par un `Object.assign` qui ferait gagner le dernier
 * ecrit:
 *
 * - les deplacements et la rotation s'AJOUTENT, si bien que la secousse se pose
 *   sur la position de depart de la transition au lieu de la remplacer;
 * - les echelles se MULTIPLIENT, parce qu'elles sont des facteurs: les ajouter
 *   ferait doubler l'image des qu'un accent est present;
 * - `flash` prend le MAXIMUM: deux voiles blancs superposes ne blanchissent pas
 *   plus que le plus fort des deux, et les additionner saturerait a 1 des que
 *   les deux sont un peu presents;
 * - `mask` et `overlay` ne peuvent pas fusionner — une seule decoupe, un seul
 *   voile — donc celui de la TRANSITION est conserve. C'est la raison pour
 *   laquelle `TransitionAccent` exclut les effets qui les reclament: aucun
 *   accent legitime n'arrive ici en portant l'un des deux.
 *
 * L'OPACITE, elle, est prise a la transition seule et l'accent n'y contribue
 * pas. Piege mesure: joue comme une transition a part entiere, `shake` porte son
 * propre fondu d'entree (`opacity = t * 3`) et `glitch` un clignotement. Les
 * multiplier ferait clignoter un « Calque + Tremblement » sur ses premieres
 * frames, alors que le calque veut precisement une image PLEINE des le debut —
 * l'accent n'apporte donc que son mouvement, jamais sa propre apparition.
 */
export function composeTransition(
  base: TransitionState,
  accent: TransitionState,
): TransitionState {
  return {
    opacity: base.opacity,
    translateX: base.translateX + accent.translateX,
    translateY: base.translateY + accent.translateY,
    scale: base.scale * accent.scale,
    flash: clamp01(Math.max(base.flash, accent.flash)),
    rotate: base.rotate + accent.rotate,
    blur: base.blur + accent.blur,
    ...(base.mask ? { mask: base.mask } : {}),
    ...(base.overlay ? { overlay: base.overlay } : {}),
  };
}

/**
 * Part de la duree occupee par l'accent, quand il y en a un.
 *
 * Un tiers: assez pour qu'une secousse se lise comme un impact, assez court pour
 * ne pas retarder l'image. En dessous d'un quart la secousse passe inapercue, au
 * dela de la moitie l'attente devient penible sur une transition d'une seconde.
 */
const ACCENT_PHASE = 1 / 3;

/**
 * Etat complet d'un clip: l'accent d'abord, la transition ensuite.
 *
 * Les deux effets se SUCCEDENT au lieu de se superposer: le plan entrant arrive
 * en tremblant, calque encore immobile et couvrant, puis le calque part et
 * l'image se revele nette. Joues ensemble, la secousse brouillait justement le
 * moment ou l'image se decouvre — les deux gestes se disputaient l'attention.
 *
 * Pendant la phase d'accent, la transition est figee a `t = 0` et non ignoree:
 * c'est ce qui maintient le calque en place et le plan entrant deja opaque. La
 * sauter afficherait le plan nu pendant le tremblement, puis ferait apparaitre
 * le voile d'un coup — un clignotement a rebours.
 *
 * C'est le point d'entree du compositeur, qui n'a jamais a savoir s'il y a un
 * accent ni comment les deux phases s'articulent.
 */
export function transitionStateFor(
  type: TransitionType,
  t: number,
  role: 'incoming' | 'outgoing',
  accent?: TransitionAccent,
): TransitionState {
  const state = (kind: TransitionType, progress: number): TransitionState =>
    role === 'incoming' ? incomingState(kind, progress) : outgoingState(kind, progress);

  if (!accent) return state(type, t);

  if (t < ACCENT_PHASE) {
    // Phase 1: l'accent joue sur sa propre course complete, transition figee au
    // depart. `composeTransition` garde le voile et ignore l'opacite de
    // l'accent, pour la raison decrite plus haut.
    return composeTransition(state(type, 0), state(accent, t / ACCENT_PHASE));
  }

  /*
    Phase 2: la transition reprend a zero et va jusqu'au bout.

    L'accent n'est PLUS compose ici. Le laisser courir en parallele ramenerait
    exactement le defaut qu'on corrige, et son etat neutre de fin de course
    n'apporterait de toute facon plus rien.
  */
  return state(type, (t - ACCENT_PHASE) / (1 - ACCENT_PHASE));
}

/** Un type est-il un glissement de calque, quel qu'en soit le sens ? */
export function isPaperSlide(type: TransitionType): boolean {
  return (
    type === 'paperSlideLeft' ||
    type === 'paperSlideRight' ||
    type === 'paperSlideUp' ||
    type === 'paperSlideDown'
  );
}

/**
 * Une transition a-t-elle besoin que le clip precedent soit aussi decode ?
 *
 * `flash`, les glissements de calque et `none` s'en passent: les deux premiers
 * couvrent l'ecran (voile plein pour l'un, plan entrant opaque sous un calque
 * pour l'autre), le troisieme coupe net. Toutes les autres montrent les DEUX
 * plans a la fois et exigent donc que le sortant soit decode.
 */
export function needsOutgoingFrame(type: TransitionType): boolean {
  return type !== 'none' && type !== 'flash' && !isPaperSlide(type);
}
