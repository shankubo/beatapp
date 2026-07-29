/**
 * Modele de donnees de Beatapp.
 *
 * Ce module est PUR: aucun DOM, aucun React, aucune chaine destinee a l'UI.
 * Tout le reste de l'application en derive.
 *
 * Conventions:
 * - le temps est TOUJOURS en secondes (jamais en frames ni en millisecondes);
 * - les positions et tailles visuelles sont en unites normalisees (0..1) de la
 *   frame, ce qui garantit qu'un canvas d'apercu de 390 px et un canvas
 *   d'export de 1080 px produisent la meme mise en page.
 */

export type Id = string;

/** Temps sur la timeline, en secondes. */
export type Seconds = number;

/** Fraction de la largeur (ou hauteur) de la frame, dans [0, 1]. */
export type NormUnit = number;

/** Format de sortie par defaut: 9:16 vertical, ce qu'attendent Instagram et WhatsApp. */
export const FRAME_WIDTH = 1080;
export const FRAME_HEIGHT = 1920;
export const FRAME_FPS = 30;

/**
 * Formats de sortie proposes.
 *
 * Nommes par leur USAGE et non par leur ratio: l'utilisateur choisit "un reel" ou
 * "un post carre", pas "du 9:16". Le ratio reste dans les dimensions.
 */
export type AspectRatioId =
  | 'reel'
  | 'square'
  | 'portrait'
  | 'landscape'
  | 'classic'
  | 'classicPortrait';

/**
 * Dimensions de frame par format.
 *
 * Toutes les dimensions sont PAIRES: H.264 en 4:2:0 sous-echantillonne la chrominance
 * d'un facteur deux, donc un cote impair fait echouer l'encodeur a l'execution. La
 * contrainte est reportee ici plutot que corrigee a l'export, pour qu'aucune valeur
 * impaire n'existe nulle part dans le projet.
 *
 * 1080 est le cote de reference: c'est ce qu'Instagram accepte sans re-encoder.
 */
export const ASPECT_RATIOS: Readonly<
  Record<AspectRatioId, { readonly width: number; readonly height: number }>
> = {
  reel: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  landscape: { width: 1920, height: 1080 },
  // 4:3 et 3:4: formats d'ECRAN, sans plateforme associee. Le 4:3 est aussi celui
  // de beaucoup de photos d'appareil, donc celui qui evite tout recadrage.
  classic: { width: 1440, height: 1080 },
  classicPortrait: { width: 1080, height: 1440 },
};

/** Format d'une frame, ou `null` si elle ne correspond a aucun format connu. */
export function aspectRatioOf(frame: {
  width: number;
  height: number;
}): AspectRatioId | null {
  for (const [id, size] of Object.entries(ASPECT_RATIOS) as [
    AspectRatioId,
    { width: number; height: number },
  ][]) {
    if (size.width === frame.width && size.height === frame.height) return id;
  }
  return null;
}

/**
 * Ratios NOMMES, pour l'affichage.
 *
 * `21:9` y figure comme cible de correspondance sans etre propose comme format:
 * quelqu'un qui saisit 2560x1080 merite de lire « ~ 21:9 » plutot que rien.
 */
const NAMED_RATIOS: readonly (readonly [string, number])[] = [
  ['9:16', 9 / 16],
  ['3:4', 3 / 4],
  ['4:5', 4 / 5],
  ['1:1', 1],
  ['5:4', 5 / 4],
  ['4:3', 4 / 3],
  ['16:9', 16 / 9],
  ['21:9', 21 / 9],
];

/**
 * Ecart maximal, en LOGARITHME du rapport, pour oser nommer un ratio.
 *
 * Mesure qui justifie ce plafond: sans lui, 240x2560 s'affichait « ~ 9:16 » avec
 * 179 % d'ecart — une etiquette qui ment. 0,06 (~6 %) laisse passer les
 * quasi-correspondances utiles (1080x1921 -> ~ 9:16, 0,1 % d'ecart) et rejette
 * les formes qu'aucun ratio connu ne decrit.
 */
const MAX_RATIO_DEVIATION = 0.06;

/**
 * Ratio lisible d'une frame, ou `null` si aucun ratio connu ne la decrit.
 *
 * Pourquoi pas une reduction par PGCD: elle est exacte mais illisible des qu'on
 * saisit un format libre. Mesure: 1080x1921 donne « 1080:1921 » et 1920x1082
 * donne « 960:541 » — un seul pixel d'ecart suffit a rendre l'etiquette inutile.
 * On rapproche donc d'une table de ratios connus.
 *
 * L'ecart se prend en logarithme et non en difference brute: 2:1 doit etre aussi
 * loin de 1:1 que 1:1 l'est de 1:2, ce qu'un ecart absolu ne respecte pas.
 *
 * Renvoie `approximate` plutot que de coller un « ~ » dans le texte: le symbole
 * est une decision d'AFFICHAGE, et le domaine reste pur.
 */
export function ratioLabel(frame: {
  width: number;
  height: number;
}): { text: string; approximate: boolean } | null {
  if (!(frame.width > 0) || !(frame.height > 0)) return null;

  const ratio = frame.width / frame.height;
  let best: readonly [string, number] | null = null;
  let bestDeviation = Infinity;

  for (const candidate of NAMED_RATIOS) {
    const deviation = Math.abs(Math.log(ratio / candidate[1]));
    if (deviation < bestDeviation) {
      bestDeviation = deviation;
      best = candidate;
    }
  }

  if (!best) return null;
  // Tolerance flottante: 1080/1920 et 9/16 ne sont pas bit-a-bit identiques.
  if (bestDeviation < 1e-9) return { text: best[0], approximate: false };
  if (bestDeviation > MAX_RATIO_DEVIATION) return null;
  return { text: best[0], approximate: true };
}

/** Orientation d'une frame, pour regrouper les formats par famille. */
export type FrameOrientation = 'horizontal' | 'square' | 'vertical';

export function frameOrientation(frame: {
  width: number;
  height: number;
}): FrameOrientation {
  if (frame.width === frame.height) return 'square';
  return frame.width > frame.height ? 'horizontal' : 'vertical';
}

/**
 * Destinations proposees dans les reglages.
 *
 * Ce sont des RACCOURCIS vers un format, pas un champ du projet: seules les
 * dimensions sont enregistrees. Deux plateformes qui partagent un format sont
 * donc interchangeables, et retirer une plateforme n'invalide aucun projet.
 */
export type PlatformPresetId =
  | 'instagramReel'
  | 'instagramPost'
  | 'instagramFeed'
  | 'tiktok'
  | 'youtubeShorts'
  | 'youtube'
  | 'facebookReel'
  | 'facebookFeed';

/**
 * Format ideal par destination.
 *
 * Valeurs tirees des recommandations publiees par chaque plateforme. Elles
 * convergent volontairement vers quatre formats: les reels verticaux sont tous
 * en 9:16, et le 4:5 est le format de fil le plus haut qu'Instagram accepte sans
 * rogner.
 */
export const PLATFORM_PRESETS: Readonly<Record<PlatformPresetId, AspectRatioId>> = {
  instagramReel: 'reel',
  instagramPost: 'square',
  instagramFeed: 'portrait',
  tiktok: 'reel',
  youtubeShorts: 'reel',
  youtube: 'landscape',
  facebookReel: 'reel',
  facebookFeed: 'portrait',
};

/**
 * Contraintes publiees par chaque destination.
 *
 * `maxDuration` seule est reellement contraignante: c'est la limite qu'un reel
 * atteint. `maxBytes` figure pour information — mesure faite, meme un export 4K
 * de 90 s (~450 Mo) ne depasse que le plafond de TikTok; partout ailleurs la
 * limite est hors de portee de ce que produit l'application.
 *
 * Ces valeurs sont des FAITS publies par les plateformes, susceptibles de changer
 * sans que ce code en soit averti. C'est pourquoi l'interface les presente comme
 * une aide indicative et non comme une regle qu'elle ferait respecter.
 */
export interface PlatformLimits {
  /** Duree maximale d'une video, en secondes. */
  maxDuration: Seconds;
  /** Taille maximale du fichier, en octets. */
  maxBytes: number;
}

export const PLATFORM_LIMITS: Readonly<Record<PlatformPresetId, PlatformLimits>> = {
  instagramReel: { maxDuration: 90, maxBytes: 4 * 1024 ** 3 },
  instagramPost: { maxDuration: 60, maxBytes: 4 * 1024 ** 3 },
  instagramFeed: { maxDuration: 60, maxBytes: 4 * 1024 ** 3 },
  tiktok: { maxDuration: 600, maxBytes: 287 * 1024 ** 2 },
  youtubeShorts: { maxDuration: 60, maxBytes: 10 * 1024 ** 3 },
  youtube: { maxDuration: 12 * 3600, maxBytes: 256 * 1024 ** 3 },
  facebookReel: { maxDuration: 90, maxBytes: 10 * 1024 ** 3 },
  facebookFeed: { maxDuration: 4 * 3600, maxBytes: 10 * 1024 ** 3 },
};

/**
 * Bornes d'un format personnalise.
 *
 * Le plancher evite un cadre trop petit pour porter du texte lisible; le plafond
 * borne la memoire (une frame RGBA en 3840 pese deja 33 Mo) et reste dans ce que
 * H.264 Baseline sait encoder.
 */
export const MIN_FRAME_SIDE = 240;
export const MAX_FRAME_SIDE = 2560;

/**
 * Ramene des dimensions saisies a la main dans le domaine du possible.
 *
 * Les cotes sont forces PAIRS: H.264 en 4:2:0 sous-echantillonne la chrominance
 * d'un facteur deux, et un cote impair fait echouer l'encodeur a l'execution —
 * apres plusieurs secondes d'export, donc au pire moment.
 *
 * Toute valeur non finie (`NaN`, +/-Infinity) retombe sur le PLANCHER, plutot que
 * de propager un `NaN` jusqu'au canvas ou il effacerait l'image. Regle unique et
 * volontaire: on pourrait renvoyer le plafond sur `+Infinity`, mais deduire une
 * intention du signe d'une valeur qui n'est de toute facon pas saisissable
 * compliquerait la fonction sans rien ameliorer pour l'utilisateur.
 */
export function clampFrameSide(value: number): number {
  if (!Number.isFinite(value)) return MIN_FRAME_SIDE;
  const bounded = Math.min(MAX_FRAME_SIDE, Math.max(MIN_FRAME_SIDE, Math.round(value)));
  return Math.floor(bounded / 2) * 2;
}

/** Duree minimale d'un clip: une frame. En dessous, le clip serait invisible. */
export const MIN_CLIP_DURATION: Seconds = 1 / FRAME_FPS;

/**
 * Bornes de la vitesse d'APERCU, jamais celle du montage.
 *
 * Ici et non dans le moteur: le store de lecture et le lecteur en ont tous deux
 * besoin, et faire dependre le store de `engine/Player` inverserait les couches.
 *
 * Le plancher est dicte par l'audio: `playbackRate` en dessous de 0,25 rend le
 * son inintelligible sur la plupart des navigateurs, et un ralenti muet ne sert
 * pas a caler sur le rythme. Au-dela de 2, l'image defile trop vite pour placer
 * quoi que ce soit.
 */
export const MIN_PREVIEW_RATE = 0.25;
export const MAX_PREVIEW_RATE = 2;

/** Garde-fous d'import (voir aussi la validation des magic bytes). */
export const MAX_IMPORT_BYTES = 500 * 1024 * 1024;
export const MAX_IMPORT_DURATION: Seconds = 5 * 60;

// ---------------------------------------------------------------------------
// Bibliotheque de medias
// ---------------------------------------------------------------------------

export type MediaKind = 'image' | 'video' | 'audio';

export interface MediaLicense {
  /** Identifiant SPDX, p. ex. `CC0-1.0`. */
  spdx: string;
  author?: string;
  sourceUrl?: string;
}

/**
 * Un media importe. Le blob lui-meme vit dans IndexedDB ou OPFS: on ne stocke
 * jamais d'objectURL ici, car ce n'est pas serialisable et la duree de vie
 * serait fausse apres un rechargement.
 */
export interface MediaAsset {
  id: Id;
  kind: MediaKind;
  /** Nom de fichier d'origine. Affiche tel quel, jamais interprete comme HTML. */
  name: string;
  mimeType: string;
  bytes: number;
  storage: { backend: 'idb' | 'opfs'; key: string };
  /** Dimensions intrinseques, pour les images et les videos. */
  width?: number;
  height?: number;
  /** Duree de la source complete, pour les videos et l'audio. */
  duration?: Seconds;
  /**
   * Vrai si une video porte une piste sonore.
   *
   * Sonde a l'import et conserve ici: rouvrir le conteneur plus tard pour la
   * meme information couterait un second parcours complet du fichier. Absent sur
   * les images et les medias audio, ou la question n'a pas de sens.
   */
  hasAudio?: boolean;
  createdAt: number;
  /** Renseigne quand le media vient de la bibliotheque de samples. */
  sampleId?: string;
  license?: MediaLicense;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** Decoupe rythmique. 0.5 = toutes les deux pulsations, 4 = quart de temps. */
export type BeatDivision = 0.5 | 1 | 2 | 4;

export const BEAT_DIVISIONS: readonly BeatDivision[] = [0.5, 1, 2, 4];

export type TransitionType =
  | 'none'
  | 'fade'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'pushLeft'
  | 'pushRight'
  | 'zoomIn'
  | 'whipPan'
  | 'flash'
  | 'shutter'
  | 'iris'
  | 'shake'
  | 'glitch'
  | 'wipeLeft'
  | 'blurFade'
  | 'paperSlideLeft'
  | 'paperSlideRight'
  | 'paperSlideUp'
  | 'paperSlideDown';

/**
 * Effet CUMULABLE par-dessus une transition.
 *
 * Un accent ne remplace pas la transition, il s'y ajoute: « Calque vers la
 * gauche » AVEC un tremblement. La liste est volontairement courte et ne
 * contient que des effets dont les canaux ne se disputent rien — `shutter` et
 * `iris` reclament tous deux le masque, et un clip ne peut porter qu'une
 * decoupe, donc ils n'ont pas leur place ici.
 *
 * `shake` et `glitch` agissent sur la position et la rotation, `flash` sur un
 * voile: aucun des trois ne touche `mask` ni `overlay`, et leurs contributions
 * s'additionnent sans qu'aucune n'en ecrase une autre.
 */
export type TransitionAccent = 'shake' | 'glitch' | 'flash';

export const TRANSITION_ACCENTS: readonly TransitionAccent[] = ['shake', 'glitch', 'flash'];

export interface Transition {
  type: TransitionType;
  /** Clampee a la moitie du plus court des deux clips voisins. */
  duration: Seconds;
  /**
   * Effet supplementaire joue EN MEME TEMPS que la transition.
   *
   * Absent = transition seule. Range dans `Transition` et non sur le clip: il
   * partage la duree et la progression de la transition, et un accent sans
   * transition pour le porter n'aurait pas de fenetre de temps ou vivre.
   */
  accent?: TransitionAccent;
}

export interface ClipTransform {
  scale: number;
  /** Decalage depuis le centre, en unites normalisees. */
  x: NormUnit;
  y: NormUnit;
  /** Rotation en radians. */
  rotation: number;
}

/**
 * Reglages appliques AUTOMATIQUEMENT a chaque media importe.
 *
 * Ils repondent au probleme du lot: importer trente photos et devoir les
 * recadrer, les redresser et les centrer une par une. Chaque option est un
 * DEFAUT, jamais un verrou — le panneau Modifier reste souverain, et rien ici
 * n'empeche de reprendre un plan a la main ensuite.
 *
 * Ranges dans les reglages d'APPLICATION et non dans le projet: ce sont des
 * preferences de travail, qui doivent survivre a « Nouveau reel » et ne pas
 * entrer dans l'historique d'annulation.
 */
export interface ImportPreferences {
  /**
   * Format de sortie applique aux NOUVEAUX projets.
   *
   * Le projet garde sa propre `frame` — c'est elle qui compte au rendu, et deux
   * projets peuvent legitimement avoir des formats differents. Cette preference
   * ne sert qu'a choisir le point de depart, pour qu'un utilisateur qui monte
   * toujours pour YouTube n'ait pas a rebasculer en 16:9 a chaque « Nouveau ».
   *
   * `null` = « garder le format par defaut de l'application » (9:16).
   */
  frame: { width: number; height: number } | null;
  /** Fond applique aux nouveaux projets. */
  background: ProjectBackground | null;
  /** Cadrage par defaut des nouveaux plans. */
  fit: 'cover' | 'contain';
  /**
   * Tourne d'un quart de tour une image dont l'orientation contredit celle du
   * cadre (une photo paysage dans un reel vertical).
   */
  autoRotate: boolean;
  /** Zoome juste assez pour supprimer les bandes vides laissees par `contain`. */
  autoZoom: boolean;
  /** Recadre sur la zone la plus riche en detail, plutot qu'au centre. */
  autoCenter: boolean;
  /**
   * Affiche les reperes de cadrage sur l'apercu.
   *
   * Par defaut FAUX. Ces reperes sont un outil de verification, pas une alerte:
   * un `cover` deborde par construction, si bien que le bandeau « les bords
   * seront rognes » s'affichait en permanence sur un montage parfaitement
   * normal. Une information toujours presente cesse d'etre lue, et masquait ici
   * le bas de l'image qu'elle pretendait aider a cadrer.
   *
   * Le reglage porte sur TOUT le calque, pas seulement sur son texte: laisser un
   * lisere rouge sans la phrase qui l'explique serait plus obscur que de tout
   * masquer.
   */
  showFramingGuides: boolean;
}

export const DEFAULT_IMPORT_PREFERENCES: ImportPreferences = {
  frame: null,
  background: null,
  fit: 'cover',
  autoRotate: false,
  autoZoom: false,
  autoCenter: false,
  showFramingGuides: false,
};

/**
 * Look nomme. `custom` signifie que l'utilisateur a bouge les curseurs a la
 * main: on conserve alors les valeurs telles quelles au lieu de les rederiver
 * du preset, sans quoi tout reglage fin serait ecrase a la relecture.
 */
export type FilterPreset =
  | 'none'
  | 'custom'
  | 'vivid'
  | 'faded'
  | 'mono'
  | 'warm'
  | 'cool'
  | 'noir'
  | 'vhs';

export interface ClipFilter {
  brightness: number;
  contrast: number;
  saturation: number;
  /** Rotation de teinte en degres. */
  hueRotate: number;
  /** Virage sepia, dans [0, 1]. */
  sepia: number;
  /** Flou en unites normalisees de la largeur de frame. */
  blur: number;
  /**
   * Dosage du look, dans [0, 1]. Le compositeur interpole entre l'identite et
   * les valeurs ci-dessus: un seul curseur suffit alors a doser un preset.
   */
  intensity: number;
  preset: FilterPreset;
}

/** Etat de depart et d'arrivee d'un zoom lent (effet Ken Burns). */
export interface KenBurns {
  toScale: number;
  toX: NormUnit;
  toY: NormUnit;
}

/** Portion de la source utilisee, pour les clips video. */
export interface ClipSource {
  in: Seconds;
  out: Seconds;
  speed: number;
}

/**
 * Une diapositive (image) ou un segment de video.
 *
 * `start` est DERIVE de l'ordre et des durees: c'est un cache recalcule par
 * `ripple()`, qui est le point de mutation unique de la piste. Ne jamais
 * l'ecrire directement.
 */
export interface Clip {
  id: Id;
  assetId: Id;
  start: Seconds;
  /** Duree occupee sur la timeline (et non dans la source). */
  duration: Seconds;
  source?: ClipSource;
  fit: 'cover' | 'contain';
  transform: ClipTransform;
  kenBurns?: KenBurns;
  transitionIn?: Transition;
  filter?: ClipFilter;
  /** Coupe le son propre du clip video. Sans effet sur les images. */
  muted: boolean;
  /** Duree posee par l'aimantation. Effacee des que l'utilisateur trim a la main. */
  beatLocked?: boolean;
  /**
   * Vide a laisser APRES ce clip, en secondes.
   *
   * Permet de supprimer un plan sans decaler la suite: le vide occupe la place
   * du plan retire, et l'image y affiche le fond du projet. Absent ou nul = les
   * plans s'enchainent sans interruption, ce qui reste le cas courant.
   *
   * Meme mecanisme que `AudioSegment.gap`, et pour la meme raison: porter le
   * vide sur le clip PRECEDENT evite d'introduire une entree « trou » que toute
   * la chaine (rendu, export, aimantation) aurait du apprendre a connaitre. La
   * piste reste ainsi une suite de clips contigus, invariant central du domaine.
   */
  gap?: Seconds;
}

/**
 * Verrouillage d'une piste.
 *
 * Une piste verrouillee refuse le decoupage et la suppression. Elle reste
 * lisible et jouable: verrouiller protege le montage, ce n'est pas un masquage.
 */
export interface TrackLock {
  locked: boolean;
}

export interface VideoTrack {
  id: Id;
  kind: 'video';
  /** Ordonnes, contigus et sans trou. L'ordre du tableau est la verite. */
  clips: Clip[];
  /**
   * Piste protegee contre le decoupage et la suppression.
   *
   * Optionnel: absent vaut deverrouille, ce qui preserve les projets enregistres
   * avant l'ajout de ce champ.
   */
  locked?: boolean;
  /**
   * Aimant: les plans suivants remontent quand on en supprime un.
   *
   * Actif par defaut (absent vaut `true`), parce que c'est le comportement
   * historique de `ripple`. Le desactiver ne cree PAS de trou — la piste video
   * reste contigue par construction — mais decale l'AUDIO de la duree supprimee,
   * de sorte que chaque son reste sur l'image qu'il accompagnait.
   *
   * C'est le vrai probleme que resout cet aimant: supprimer une image faisait
   * remonter tous les plans suivants tandis que les pistes audio gardaient leur
   * `start` absolu, et le montage se desynchronisait silencieusement.
   */
  magnet?: boolean;
}

export type AudioRole = 'music' | 'original' | 'voice';

/**
 * Un morceau d'audio conserve.
 *
 * Une piste en contient au moins un. Plusieurs segments permettent de retirer
 * un passage au milieu (couplet coupe) sans dupliquer la piste: ils sont joues
 * bout a bout, dans l'ordre, sans silence entre eux.
 */
export interface AudioSegment {
  id: Id;
  /** Bornes dans la SOURCE, avec `in < out`. */
  in: Seconds;
  out: Seconds;
  /**
   * Silence a inserer APRES ce segment, en secondes.
   *
   * Sert a retirer un passage sans decaler la suite: le vide occupe la place du
   * passage supprime. Absent ou nul = les segments se suivent sans interruption,
   * ce qui est le cas courant.
   */
  gap?: Seconds;
}

export interface AudioTrack {
  id: Id;
  kind: 'audio';
  assetId: Id;
  role: AudioRole;
  /** Position de depart sur la timeline. */
  start: Seconds;
  /**
   * Extrait principal de la source.
   *
   * Conserve pour la compatibilite des projets enregistres et parce que la
   * grande majorite des pistes n'ont qu'un seul extrait. Quand `segments` est
   * renseigne, c'est lui qui fait foi et ce champ vaut le premier segment.
   */
  source: { in: Seconds; out: Seconds };
  /** Decoupage multiple. Absent = piste continue decrite par `source`. */
  segments?: AudioSegment[];
  /** 0..1.5 — au-dela de 1, le limiteur du mixage evite le clipping. */
  gain: number;
  muted: boolean;
  fadeIn: Seconds;
  fadeOut: Seconds;
  /** Baisse automatiquement cette piste sous une autre (voix par-dessus musique). */
  duck?: { targetTrackId: Id; amount: number };
  /** Piste protegee contre le decoupage et la suppression. */
  locked?: boolean;
  /**
   * Aimant: les segments suivants se recollent quand on en supprime un.
   *
   * Actif par defaut (absent vaut `true`), parce que c'est le comportement
   * historique: `removeSegment` recollait toujours les morceaux. Le desactiver
   * laisse un SILENCE a la place du passage retire, ce qui permet de trouer une
   * musique sans decaler ce qui suit.
   */
  magnet?: boolean;
}

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

export type TextAnim = 'none' | 'fade' | 'popIn' | 'slideUp' | 'typewriter';

export type TextPreset = 'plain' | 'caption' | 'karaoke' | 'sticker' | 'neon';

/**
 * Familles de polices proposees.
 *
 * Uniquement des piles systeme: aucune police n'est telechargee. C'est un choix
 * de confidentialite (pas de requete vers un CDN de fontes) et de fiabilite a
 * l'export — une police encore en chargement rendrait un texte decale entre
 * l'apercu et le MP4.
 */
export type FontChoice = 'sans' | 'serif' | 'mono' | 'condensed' | 'rounded';

export const FONT_CHOICES: readonly FontChoice[] = [
  'sans',
  'serif',
  'mono',
  'condensed',
  'rounded',
];

/** Pile CSS de chaque choix, partagee par l'apercu et l'export. */
export const FONT_STACKS: Record<FontChoice, string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  condensed: '"Arial Narrow", "Helvetica Neue", Impact, sans-serif',
  rounded: '"SF Pro Rounded", "Segoe UI Variable", Verdana, sans-serif',
};

export interface TextStyle {
  /**
   * Choix de police cote UI. `fontFamily` en est la pile CSS resolue: le
   * renderer ne lit que `fontFamily`, ce qui evite de propager la table des
   * piles jusqu'au moteur de dessin.
   */
  font: FontChoice;
  fontFamily: string;
  /** Fraction de la largeur de frame: independant de la resolution de rendu. */
  fontSize: NormUnit;
  fontWeight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  /** Interlettrage, en fraction de la taille de police. */
  letterSpacing: number;
  stroke?: { color: string; width: number };
  shadow?: { color: string; blur: number; x: number; y: number };
  background?: { color: string; padding: number; radius: number };
  /**
   * Lueur autour des lettres.
   *
   * Distincte de `shadow`, qui est une ombre PORTEE — decalable, et dessinee
   * une fois. Une lueur est centree et obtenue par passes successives: c'est ce
   * cumul qui lui donne sa densite, qu'une ombre unique ne peut pas rendre.
   *
   * `radius` est en fraction de la largeur de frame, comme tous les flous.
   */
  glow?: { color: string; radius: number; intensity: number };
  /**
   * Remplissage en degrade, qui REMPLACE `color` quand il est present.
   *
   * `angle` est en radians, 0 = de gauche a droite. Le degrade est calcule sur
   * la boite du texte et non sur la frame: un texte deplace garde donc le meme
   * rendu, ce qu'un degrade ancre a la frame ne ferait pas.
   */
  gradient?: { from: string; to: string; angle: number };
  preset?: TextPreset;
}

export interface TextOverlay {
  id: Id;
  /**
   * Contenu saisi par l'utilisateur. Ce n'est JAMAIS une cle i18n: on
   * n'applique aucune traduction au texte de l'utilisateur.
   */
  text: string;
  start: Seconds;
  duration: Seconds;
  /** Centre de la boite de texte. */
  x: NormUnit;
  y: NormUnit;
  maxWidth: NormUnit;
  rotation: number;
  style: TextStyle;
  animation: { in: TextAnim; out: TextAnim; duration: Seconds };
  beatPulse?: { enabled: boolean; amount: number };
  /**
   * Surlignage progressif, pose par `lyricOverlays` sur les lignes de paroles.
   *
   * Le compositeur ne connait donc pas les paroles: il dessine une incrustation
   * qui se trouve porter une progression. Absent sur un texte libre.
   */
  karaoke?: { color: string; words?: LyricWord[] };
  /**
   * Filtre colorimetrique applique au texte.
   *
   * Reutilise `ClipFilter` tel quel: un look « VHS » ou « mono » a le meme sens
   * sur du texte que sur une image, et les redefinir aurait fait deux tables de
   * presets a garder coherentes.
   */
  filter?: ClipFilter;
}

/**
 * Masque decoupe DANS un texte: les lettres laissent voir le montage, le reste
 * de la frame est couvert d'une couleur.
 *
 * C'est l'inverse d'une incrustation ordinaire — le texte n'est pas dessine, il
 * DECOUPE. D'ou un type a part et non un drapeau sur `TextOverlay`: presque
 * aucun champ de style n'a de sens ici (ni couleur de remplissage, ni ombre, ni
 * karaoke), et les melanger aurait produit un objet dont la moitie des reglages
 * seraient sans effet selon un booleen.
 *
 * Le masque est un calque PLEIN CADRE pose par-dessus les clips: il ne
 * s'attache a aucun d'eux et peut donc durer sur plusieurs plans.
 */
export interface TextMask {
  id: Id;
  /** Contenu saisi par l'utilisateur — jamais une cle i18n. */
  text: string;
  start: Seconds;
  duration: Seconds;
  /** Centre du texte, en unites normalisees. */
  x: NormUnit;
  y: NormUnit;
  rotation: number;
  font: FontChoice;
  fontFamily: string;
  /** Fraction de la largeur de frame. Un masque va bien au-dela d'un texte. */
  fontSize: NormUnit;
  fontWeight: number;
  letterSpacing: number;
  /** Couleur couvrant tout ce qui n'est PAS dans les lettres. */
  fillColor: string;
  /**
   * Opacite de cette couleur, dans [0, 1].
   *
   * A 1 le fond est opaque et seules les lettres montrent l'image; en dessous,
   * le montage transparait aussi autour — c'est le reglage de transparence
   * demande, exprime en pourcentage cote interface.
   */
  fillOpacity: number;
  /**
   * Inverse la decoupe: les lettres sont pleines et le reste laisse voir.
   *
   * Le meme masque sert ainsi aux deux effets, sans avoir a ressaisir le texte.
   */
  inverted?: boolean;
}

// ---------------------------------------------------------------------------
// Paroles
// ---------------------------------------------------------------------------

/**
 * Une ligne de paroles, avec son temps d'apparition sur la timeline.
 *
 * Les paroles ne sont pas transcrites automatiquement: aucun modele de
 * reconnaissance vocale n'est disponible dans le navigateur, et en envoyer un a
 * un service externe contredirait la promesse "rien ne quitte l'appareil".
 * L'utilisateur saisit donc le texte, et `alignLyricsToBeats` place les lignes
 * sur la grille rythmique deja detectee — ce qui fait tout le travail penible.
 */
/**
 * Un mot horodate dans une ligne de paroles.
 *
 * `start` et `end` sont en temps TIMELINE, comme la ligne qui les contient: on
 * evite ainsi une conversion a chaque frame de rendu.
 */
export interface LyricWord {
  text: string;
  start: Seconds;
  end: Seconds;
}

export interface LyricLine {
  id: Id;
  text: string;
  start: Seconds;
  duration: Seconds;
  /**
   * Decoupage au mot, quand la source le fournit (Whisper).
   *
   * Optionnel a dessein: des paroles collees ou un fichier `.lrc` n'ont pas
   * cette information, et le surlignage doit alors se rabattre sur une
   * progression deduite de la duree de la ligne.
   */
  words?: LyricWord[];
}

export interface Lyrics {
  lines: LyricLine[];
  /** Style commun a toutes les lignes: on edite l'apparence une seule fois. */
  style: TextStyle;
  /** Position commune des lignes. */
  x: NormUnit;
  y: NormUnit;
  maxWidth: NormUnit;
  animation: { in: TextAnim; out: TextAnim; duration: Seconds };
  /** Nombre de temps qu'occupe une ligne quand on cale sur le rythme. */
  beatsPerLine: number;
  /**
   * Surlignage progressif facon karaoke.
   *
   * Quand il est actif, la partie deja chantee de la ligne est peinte dans
   * `karaokeColor` et le reste garde `style.color`. La progression suit les mots
   * horodates si la ligne en a, sinon la duree de la ligne.
   */
  karaoke?: {
    enabled: boolean;
    /** Couleur de la partie deja chantee. */
    color: string;
  };
}

/**
 * Etat de la piste TEXTE de la timeline.
 *
 * Vit sur le projet et non sur `Lyrics`: la piste texte reunit les incrustations
 * libres ET les paroles, alors que `lyrics` peut etre absent. Un verrou pose sur
 * `lyrics` ne protegerait donc pas les textes libres.
 */
export interface TextTrackState {
  locked?: boolean;
  /**
   * Aimant: les incrustations suivantes se recollent quand on en supprime une.
   *
   * INACTIF par defaut (absent vaut `false`), contrairement a l'audio. Un texte
   * est pose a un instant precis, choisi pour tomber sur une image ou une parole:
   * recoller automatiquement les suivants deplacerait des textes que l'utilisateur
   * a cale a la main, ce qui serait destructeur.
   */
  magnet?: boolean;
}

// ---------------------------------------------------------------------------
// Rythme
// ---------------------------------------------------------------------------

/** Version de l'algorithme. L'incrementer invalide les analyses en cache. */
/**
 * Version 3.
 *
 * - v2: plage de tempo elargie a 50-210 BPM et biais perceptuel remplace par une
 *   gaussienne en log-tempo. Corrige les ballades, detectees au DOUBLE de leur
 *   tempo (mesure: 55 BPM lu 110). Detection de la metrique 3/4.
 * - v3: `BeatFeatures` — dynamique, sections, timbre.
 * - v4: `BeatFeatures.onsets` — les attaques reelles, jusque-la jetees apres
 *   l'estimation du tempo.
 *
 * L'incrementer invalide le cache IndexedDB des analyses: sans cela, un morceau
 * deja importe garderait son ancien BPM faux et n'aurait aucun nouveau critere.
 */
export const BEAT_ALGO_VERSION = 4;

/**
 * Critere de calage: sur QUOI poser les plans.
 *
 * `beat` est la pulsation, seul critere d'origine. Les autres repondent au constat
 * qu'un montage cale sur chaque temps devient mecanique: une musique change aussi
 * d'energie, de section et de couleur, et ce sont souvent ces instants-la qu'on
 * veut voir a l'image.
 */
export type BeatFeatureKind = 'beat' | 'onsets' | 'dynamics' | 'sections' | 'timbre';

/**
 * Instants de calage autres que la pulsation.
 *
 * Absent sur une analyse anterieure a `BEAT_ALGO_VERSION` 3: le champ est optionnel
 * et l'UI se rabat alors sur la pulsation seule.
 */
export interface BeatFeatures {
  /**
   * Attaques REELLES, irregulieres — a ne pas confondre avec `BeatMap.beats`.
   *
   * `beats` est une grille de periode CONSTANTE, volontairement sans trou pour
   * qu'on puisse aimanter partout, y compris dans un silence. Elle ne peut donc
   * jamais rendre un rythme qui respire. `onsets` est l'inverse: uniquement les
   * instants ou quelque chose a effectivement frappe, avec leurs ecarts vrais.
   *
   * C'est ce que l'utilisateur montre quand il pointe des traits irreguliers sur
   * la forme d'onde: il ne demande pas le metronome, il demande les impacts.
   */
  onsets: Seconds[];
  /** Ruptures d'energie: montees et chutes franches. */
  dynamics: Seconds[];
  /** Frontieres de sections: couplet, refrain, pont. */
  sections: Seconds[];
  /** Changements de couleur sonore (entree d'un instrument, filtre). */
  timbre: Seconds[];
  /**
   * Fiabilite par critere, dans [0, 1].
   *
   * Portee par le MODELE et non deduite a l'affichage: c'est elle qui permet de
   * griser un critere que la musique ne porte pas, plutot que d'offrir un bouton
   * qui ne ferait rien.
   */
  confidence: Partial<Record<BeatFeatureKind, number>>;
}

export interface BeatMap {
  assetId: Id;
  /** Temps dans la SOURCE (pas sur la timeline), strictement croissants. */
  beats: Seconds[];
  /** Force d'attaque de chaque beat, dans [0, 1]. Meme longueur que `beats`. */
  strength: number[];
  bpm: number;
  /** Fiabilite dans [0, 1]. Sous 0,4 on avertit l'utilisateur. */
  confidence: number;
  /** Les temps forts sont les `beats[i]` tels que `i % beatsPerBar === barOffset`. */
  barOffset: number;
  beatsPerBar: number;
  analyzedAt: number;
  algoVersion: number;
  /** Autres points de calage. Absent sur une analyse d'avant la version 3. */
  features?: BeatFeatures;
}

// ---------------------------------------------------------------------------
// Projet
// ---------------------------------------------------------------------------

export type ProjectBackground =
  | { type: 'color'; color: string }
  | { type: 'blur'; amount: number };

export interface FrameSpec {
  width: number;
  height: number;
  fps: number;
}

export interface SnappingSettings {
  enabled: boolean;
  division: BeatDivision;
}

/**
 * Version 2: `TextStyle.font`, les champs etendus de `ClipFilter`, les segments
 * audio et les paroles. Les projets v1 sont migres par `migrateProject`.
 */
export const PROJECT_SCHEMA_VERSION = 2;

export interface Project {
  id: Id;
  schemaVersion: number;
  /** Saisi par l'utilisateur — jamais traduit. */
  name: string;
  createdAt: number;
  updatedAt: number;
  frame: FrameSpec;
  background: ProjectBackground;
  assets: Record<Id, MediaAsset>;
  /** Une seule piste video en v1. */
  videoTrack: VideoTrack;
  audioTracks: AudioTrack[];
  overlays: TextOverlay[];
  /**
   * Masques texte, dessines par-dessus les clips mais SOUS les incrustations.
   *
   * Une liste a part et non melangee a `overlays`: un masque couvre toute la
   * frame, donc son ordre de dessin n'est pas negociable — une incrustation
   * posee dessous serait invisible.
   */
  textMasks?: TextMask[];
  /** Paroles synchronisees. Absent = aucune parole saisie. */
  lyrics?: Lyrics;
  /**
   * Verrou et aimant de la piste TEXTE.
   *
   * Sur le projet et non sur `lyrics`: la piste texte reunit les incrustations
   * libres et les paroles, et `lyrics` peut etre absent.
   */
  textTrack?: TextTrackState;
  beatMap?: BeatMap;
  snapping: SnappingSettings;
}

// ---------------------------------------------------------------------------
// Types de rendu (runtime uniquement, jamais persistes)
// ---------------------------------------------------------------------------

/** Ce que le compositeur sait dessiner. Volontairement minimal. */
export type ClipLayer = {
  type: 'clip';
  clip: Clip;
  frame: CanvasImageSource | null;
  /** Dimensions de la source, requises pour le calcul du cadrage. */
  sourceWidth: number;
  sourceHeight: number;
  opacity: number;
  /** Progression dans le clip, dans [0, 1] — pilote le Ken Burns. */
  clipProgress: number;
  /**
   * Transition en cours sur ce clip, ou `null` si le clip est affiche seul.
   * `role` dit si ce clip est celui qui arrive ou celui qui part, ce que le
   * compositeur ne peut pas deviner autrement.
   */
  transition: {
    type: TransitionType;
    /** 0 = debut de la transition, 1 = terminee. */
    progress: number;
    role: 'incoming' | 'outgoing';
    /** Effet cumule par-dessus, s'il y en a un. */
    accent?: TransitionAccent;
  } | null;
};

export type TextLayer = {
  type: 'text';
  overlay: TextOverlay;
  /** Progression de l'animation d'entree, dans [0, 1]. */
  progressIn: number;
  /** Progression de l'animation de sortie, dans [0, 1]. */
  progressOut: number;
  /** Impulsion rythmique, dans [0, 1]. 0 quand `beatPulse` est absent. */
  pulse: number;
  /**
   * Fraction du texte deja chantee, dans [0, 1]. 0 sans surlignage karaoke.
   *
   * Resolue par la scene et non par le rendu: le compositeur reste une fonction
   * pure de la scene, sans connaissance du temps.
   */
  sung: number;
};

/**
 * Masque texte resolu pour un instant donne.
 *
 * Aucune progression d'animation ici: un masque plein cadre qui apparaitrait en
 * fondu montrerait le montage nu pendant sa montee, ce qui defait l'effet. Il
 * est present ou absent.
 */
export type TextMaskLayer = {
  type: 'textMask';
  mask: TextMask;
};

export type Layer = ClipLayer | TextLayer | TextMaskLayer;

export interface Scene {
  time: Seconds;
  frame: FrameSpec;
  background: ProjectBackground;
  layers: Layer[];
}
