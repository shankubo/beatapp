/**
 * Etat du projet, avec annulation/rétablissement.
 *
 * Seul ce store contient l'etat PERSISTANT. La position de lecture et l'etat de
 * l'interface vivent dans des stores separes: les melanger ferait entrer la
 * tete de lecture dans l'historique d'annulation, et un "annuler" reculerait le
 * temps au lieu de defaire une edition.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { produce } from 'immer';

import {
  addAsset,
  appendAssetToTimeline,
  applyImportPreferences,
  type FocalPoint,
  createAudioTrack,
  createClipForAsset,
  createEmptyProject,
  completeLyrics,
  createLyrics,
  createTextMask,
  createTextOverlay,
  filterForPreset,
  MIN_TEXT_DURATION,
  musicTrack,
  splitTextOverlay,
  textStyleForPreset,
  withFont,
} from '../domain/project';
import {
  appendClip,
  clipIndexAt,
  duplicateClip,
  insertClip,
  moveClip,
  removeClip,
  setClipDuration,
  setUniformDuration,
  splitClipAt,
  trimClipEnd,
  trimClipStart,
  videoDuration,
} from '../domain/timeline';
import {
  removeRange,
  duplicateSegment,
  moveSegment,
  removeSegment,
  trackDuration,
  setTrackRange,
  splitAt,
  updateSegment,
} from '../domain/audioEdit';
import { alignLyricsToBeats, parseLyricLines } from '../domain/lyrics';
import { newId } from '../lib/id';
import {
  defaultTolerance,
  distributeTrackOnBeats,
  quantizeTrackBoundaries,
  featureGrid,
  timelineGrid,
} from '../domain/snapping';
import { ASPECT_RATIOS, clampFrameSide } from '../domain/types';
import { usePreferencesStore } from './usePreferencesStore';
// Lecture SEULE de la position courante, via getState: aucun abonnement, donc
// pas de cycle de rendu entre les deux stores.
import { usePlaybackStore } from './usePlaybackStore';
import type {
  AspectRatioId,
  BeatDivision,
  BeatFeatureKind,
  BeatMap,
  Clip,
  ClipFilter,
  FilterPreset,
  FontChoice,
  Id,
  LyricLine,
  Lyrics,
  MediaAsset,
  Project,
  ProjectBackground,
  Seconds,
  TextMask,
  TextOverlay,
  TextPreset,
  Transition,
} from '../domain/types';

interface ProjectState {
  project: Project;

  // --- Cycle de vie
  replaceProject: (project: Project) => void;
  /** Repart d'un projet vierge. Le nettoyage des blobs est fait par l'appelant. */
  newProject: (name: string) => void;
  renameProject: (name: string) => void;
  /**
   * Change le format de sortie (9:16, 1:1, 4:5, 16:9).
   *
   * Ne touche que les dimensions: les `transform` des clips sont en unites
   * normalisees et survivent donc au changement, ce qui evite de perdre un
   * recadrage regle a la main. `fps` n'a rien a voir avec le format.
   */
  setFrameAspect: (aspect: AspectRatioId) => void;
  /**
   * Format libre, en pixels. Les cotes sont bornes et forces pairs par le domaine.
   *
   * Separee de `setFrameAspect` a dessein: celle-ci prend un format nomme et ne
   * peut pas produire de dimensions invalides, alors que celle-la accepte une
   * saisie et doit donc l'assainir.
   */
  setFrameSize: (size: { width: number; height: number }) => void;
  /** Fond visible autour d'un plan qui ne remplit pas le cadre (`contain`). */
  setBackground: (background: ProjectBackground) => void;

  // --- Medias
  addAsset: (asset: MediaAsset) => void;
  /**
   * Ajoute un media au montage, en lui appliquant les preferences d'import
   * (cadrage, redressement, zoom, recentrage).
   *
   * Le plan se pose APRES celui que la tete de lecture traverse. Hors de tout
   * plan — piste vide, ou tete au-dela du dernier — il est ajoute a la fin.
   * `index` force explicitement le rang, pour un appelant qui sait mieux.
   *
   * `focal` est la zone d'interet mesuree par l'appelant: le domaine reste pur et
   * n'analyse aucun pixel lui-meme.
   */
  addAssetToTimeline: (
    asset: MediaAsset,
    options?: { slideDuration?: Seconds; focal?: FocalPoint; index?: number },
  ) => void;
  removeAsset: (assetId: Id) => void;

  // --- Clips
  addClip: (asset: MediaAsset, index?: number) => void;
  /**
   * Retire un plan.
   *
   * `leaveGap` laisse un VIDE de la duree du plan a sa place, au lieu de faire
   * remonter les suivants. Rien d'autre ne bouge alors: ni l'audio, ni le texte.
   */
  removeClip: (clipId: Id, options?: { leaveGap?: boolean }) => void;
  moveClip: (from: number, to: number) => void;
  setClipDuration: (clipId: Id, duration: Seconds) => void;
  trimStart: (clipId: Id, delta: Seconds) => void;
  trimEnd: (clipId: Id, delta: Seconds) => void;
  updateClip: (clipId: Id, patch: Partial<Clip>) => void;
  /** Remplace le media d'un clip en conservant sa place et sa duree. */
  replaceClipAsset: (clipId: Id, asset: MediaAsset) => void;
  duplicateClip: (clipId: Id) => void;
  setClipFilter: (clipId: Id, filter: ClipFilter | undefined) => void;
  setFilterPreset: (clipId: Id, preset: FilterPreset) => void;
  setFilterForAll: (filter: ClipFilter | undefined) => void;
  setTransition: (clipId: Id, transition: Transition | undefined) => void;
  /** `undefined` retire la transition partout (coupe franche sur tout le montage). */
  setTransitionForAll: (transition: Transition | undefined) => void;
  setUniformDuration: (duration: Seconds) => void;

  // --- Audio
  setMusic: (asset: MediaAsset) => void;
  /**
   * Ajoute le son d'origine d'une video sur sa propre piste.
   *
   * Une piste separee et non un drapeau sur le clip: c'est ce qui donne acces au
   * volume, aux fondus, au decoupage et au mixage d'export sans dupliquer la
   * moindre logique. Le son suit le plan — la piste demarre la ou le clip est
   * pose.
   *
   * Sans effet si le media n'a pas de piste sonore, ou si son son est deja
   * present: reappuyer ne doit pas empiler deux fois le meme audio.
   */
  addOriginalAudio: (asset: MediaAsset, options?: { start?: Seconds }) => void;
  /** Retire le son d'origine attache a un media. */
  removeOriginalAudio: (assetId: Id) => void;
  updateAudioTrack: (trackId: Id, patch: Partial<Project['audioTracks'][number]>) => void;
  removeAudioTrack: (trackId: Id) => void;
  /** Definit le debut et la fin de l'extrait utilise. */
  setAudioRange: (trackId: Id, range: { in: Seconds; out: Seconds }) => void;
  /** Retire un passage: le segment traverse est scinde. */
  removeAudioRange: (trackId: Id, from: Seconds, to: Seconds) => void;
  /** Pose une frontiere de decoupe sans rien retirer. */
  splitAudio: (trackId: Id, at: Seconds) => void;
  /** Duplique un passage et pose la copie juste apres l'original. */
  duplicateAudioSegment: (trackId: Id, segmentId: Id) => void;
  /** Deplace un passage d'un rang dans l'ordre de lecture. */
  moveAudioSegment: (trackId: Id, segmentId: Id, direction: -1 | 1) => void;
  /**
   * Coupe TOUT ce que la tete de lecture traverse: le plan et chaque piste
   * audio.
   *
   * Une seule action pour l'ensemble, et donc un seul point d'annulation: couper
   * puis annuler doit retablir le montage entier, pas un morceau a la fois.
   */
  splitAtPlayhead: (at: Seconds) => void;

  // --- Verrou et aimant des pistes
  /**
   * Verrouille une piste: plus de decoupage ni de suppression.
   *
   * `'audio'` n'est pas accepte ici: chaque piste audio a son propre verrou, pose
   * par `setAudioTrackFlags`.
   */
  setTrackLocked: (track: 'video' | 'text', locked: boolean) => void;
  /** Verrou et aimant d'UNE piste audio. */
  setAudioTrackFlags: (
    trackId: Id,
    patch: { locked?: boolean; magnet?: boolean },
  ) => void;
  /** Aimant de la piste texte: recoller ou non apres une suppression. */
  setTextTrackMagnet: (magnet: boolean) => void;
  /**
   * Aimant de la piste image.
   *
   * Actif, le son et le texte SUIVENT l'image quand un plan est supprime, ce qui
   * preserve la synchronisation. Inactif, ils gardent leur position absolue.
   */
  setVideoTrackMagnet: (magnet: boolean) => void;
  /**
   * Retire un passage audio.
   *
   * `leaveGap` laisse un SILENCE de la meme duree a sa place. Omis, l'aimant de
   * la piste decide, ce qui preserve le comportement anterieur.
   */
  removeAudioSegment: (
    trackId: Id,
    segmentId: Id,
    options?: { leaveGap?: boolean },
  ) => void;
  updateAudioSegment: (
    trackId: Id,
    segmentId: Id,
    patch: { in?: Seconds; out?: Seconds },
  ) => void;
  /** Decale la piste sur la timeline, pour caler l'audio sur l'image. */
  setAudioOffset: (trackId: Id, start: Seconds) => void;

  // --- Texte
  addText: (text: string, options?: { start?: Seconds; preset?: TextPreset }) => Id;
  updateText: (overlayId: Id, patch: Partial<TextOverlay>) => void;
  setTextPreset: (overlayId: Id, preset: TextPreset) => void;
  setTextFont: (overlayId: Id, font: FontChoice) => void;
  /**
   * Retire une incrustation de texte.
   *
   * `leaveGap` laisse sa place vide au lieu de faire remonter les suivantes.
   * Omis, l'aimant de la piste texte decide.
   */
  removeText: (overlayId: Id, options?: { leaveGap?: boolean }) => void;

  // --- Masques texte
  /** Ajoute un masque decoupant le montage dans les lettres. Rend son id. */
  addTextMask: (text: string, options?: { start?: Seconds; duration?: Seconds }) => Id;
  updateTextMask: (maskId: Id, patch: Partial<TextMask>) => void;
  removeTextMask: (maskId: Id) => void;

  // --- Paroles
  /** Remplace les paroles a partir d'un texte colle, calees sur le rythme. */
  setLyricsFromText: (raw: string, options?: { startAt?: Seconds }) => void;
  /**
   * Pose des lignes DEJA horodatees (fichier `.lrc`/`.srt`, ou dictee).
   *
   * Distincte de `setLyricsFromText`: ici le calage existe et fait autorite, il
   * ne faut donc surtout pas le recalculer. Un fichier karaoke est plus precis
   * que n'importe quelle grille deduite, et une dictee est datee a l'instant ou
   * l'utilisateur a parle.
   */
  setLyricsLines: (lines: readonly LyricLine[]) => void;
  updateLyrics: (patch: Partial<Omit<Lyrics, 'lines'>>) => void;
  setLyricsFont: (font: FontChoice) => void;
  updateLyricLine: (lineId: Id, patch: Partial<Omit<LyricLine, 'id'>>) => void;
  removeLyricLine: (lineId: Id) => void;
  /** Recale les lignes existantes sur la grille rythmique courante. */
  realignLyrics: (options?: { startAt?: Seconds }) => void;
  clearLyrics: () => void;

  // --- Rythme
  setBeatMap: (beatMap: BeatMap | undefined) => void;
  setSnapping: (patch: Partial<{ enabled: boolean; division: BeatDivision }>) => void;
  /**
   * Repartit les plans sur les instants d'un critere.
   *
   * `criterion` omis vaut `beat`: la pulsation, seul comportement d'origine.
   */
  distributeOnBeats: (options?: {
    mode?: 'each' | 'everyN';
    n?: number;
    criterion?: BeatFeatureKind;
  }) => void;
  quantizeCuts: () => void;
}

/** Marque le projet comme modifie: fait par toutes les mutations. */
function touched(project: Project): Project {
  return { ...project, updatedAt: Date.now() };
}

/**
 * Applique une operation d'edition a une piste audio.
 *
 * Le facteur commun est la resolution de la duree de la SOURCE: toutes les
 * operations de `domain/audioEdit` en ont besoin pour borner les segments, et
 * elle vit sur le media, pas sur la piste.
 */
function editAudioTrack(
  project: Project,
  trackId: Id,
  edit: (track: Project['audioTracks'][number], sourceDuration: Seconds) => Project['audioTracks'][number],
): Project {
  const index = project.audioTracks.findIndex((track) => track.id === trackId);
  if (index < 0) return project;

  const track = project.audioTracks[index]!;

  /*
    Verrou de la piste, controle ICI et non chez chaque appelant.

    Quatre actions passent par cette fonction (`setAudioRange`,
    `removeAudioRange`, `splitAudio`, `removeAudioSegment`, `updateAudioSegment`)
    et aucune ne verifiait le cadenas. Le poser au point de passage plutot qu'a
    chaque appel garantit qu'une action ajoutee plus tard sera protegee sans
    qu'on ait a y penser.
  */
  if (track.locked === true) return project;

  const asset = project.assets[track.assetId];
  // Sans duree connue, on ne peut pas borner: l'operation est refusee plutot que
  // d'ecrire des bornes fausses.
  if (!asset?.duration) return project;

  const audioTracks = [...project.audioTracks];
  audioTracks[index] = edit(track, asset.duration);

  return touched({ ...project, audioTracks });
}

/**
 * Grille rythmique courante en temps timeline, ou un tableau vide.
 * Partagee par la repartition des clips et le calage des paroles.
 */
function currentGrid(project: Project): Seconds[] {
  if (!project.beatMap) return [];
  return timelineGrid(project.beatMap, musicTrack(project), project.snapping.division);
}

/*
  Verrous de piste, regroupes ici.

  BUG CORRIGE: le cadenas ne protegeait qu'une poignee d'actions
  (`removeClip`, `splitAtPlayhead`, `removeText`). Tout le reste passait au
  travers — deplacer un plan, le rogner, changer sa duree, le dupliquer, poser
  un filtre, supprimer une piste audio ou un segment… Un cadenas qui n'empeche
  qu'un dixieme des modifications est pire qu'aucun cadenas: il promet une
  protection qu'il n'assure pas.

  On refuse en SILENCE (etat inchange) plutot qu'en levant: l'appelant est
  toujours un geste d'interface, et une exception y serait ingerable.
*/

/**
 * Ou s'est pose le dernier plan importe, pour enchainer un lot.
 *
 * HORS du store a dessein: c'est un detail d'enchainement entre deux appels
 * successifs, pas un etat du projet. L'y mettre le ferait entrer dans
 * l'historique d'annulation et dans l'enregistrement automatique.
 */
let lastInsert: { index: number; clipCount: number; time: number } | null = null;

/** La piste image est-elle verrouillee ? */
function isVideoLocked(project: Project): boolean {
  return project.videoTrack.locked === true;
}

/** La piste texte est-elle verrouillee ? */
function isTextLocked(project: Project): boolean {
  return project.textTrack?.locked === true;
}

/** La piste audio `trackId` est-elle verrouillee ? */
function isAudioLocked(project: Project, trackId: Id): boolean {
  return project.audioTracks.find((track) => track.id === trackId)?.locked === true;
}

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set, get) => ({
      // Le nom par defaut est remplace par la couche UI, qui seule connait la
      // langue courante.
      project: createEmptyProject('Reel'),

      replaceProject: (project) => set({ project }),

      newProject: (name) => {
        // Le format et le fond choisis dans les Reglages sont des preferences
        // durables: un nouveau reel doit en heriter, pas les oublier.
        const { frame, background } = usePreferencesStore.getState().importPreferences;
        return set({ project: createEmptyProject(name, { frame, background }) });
      },

      renameProject: (name) => set((state) => ({ project: touched({ ...state.project, name }) })),

      setFrameAspect: (aspect) =>
        set((state) => {
          const size = ASPECT_RATIOS[aspect];
          /*
            Le choix est memorise pour les PROCHAINS projets, en plus d'etre
            applique au projet courant. Sans cela, regler le format puis taper
            « Nouveau reel » le perdait aussitot.
          */
          usePreferencesStore
            .getState()
            .setImportPreferences({ frame: { width: size.width, height: size.height } });
          return {
            project: touched({
              ...state.project,
              frame: { ...state.project.frame, width: size.width, height: size.height },
            }),
          };
        }),

      setBackground: (background) =>
        set((state) => {
          usePreferencesStore.getState().setImportPreferences({ background });
          return { project: touched({ ...state.project, background }) };
        }),

      setFrameSize: ({ width, height }) =>
        set((state) => {
          const frame = {
            width: clampFrameSide(width),
            height: clampFrameSide(height),
          };
          // Memorise apres assainissement: la preference ne doit jamais contenir
          // une dimension que le domaine refuserait.
          usePreferencesStore.getState().setImportPreferences({ frame });
          return {
            project: touched({
              ...state.project,
              frame: { ...state.project.frame, ...frame },
            }),
          };
        }),

      addAsset: (asset) => set((state) => ({ project: addAsset(state.project, asset) })),

      addAssetToTimeline: (asset, options) =>
        set((state) => {
          if (isVideoLocked(state.project)) return state;

          /*
            Rang d'insertion derive de la TETE DE LECTURE.

            Bug corrige: tout import atterrissait en fin de piste, quelle que
            soit la position du trait. Poser un plan au milieu d'un montage
            imposait donc de l'ajouter puis de le remonter a la main, coupure
            par coupure.

            La regle est celle d'un logiciel de montage: le nouveau plan se pose
            APRES celui que la tete traverse. Hors de tout plan — piste vide, ou
            tete au-dela du dernier — on retombe sur l'ajout en fin.
          */
          /*
            Rang d'insertion, avec REPRISE pour les lots.

            Piege attrape par les tests: un import multiple boucle sur cette
            action sans deplacer la tete de lecture. En rederivant le rang a
            chaque appel, les trois fichiers d'un lot visaient tous le meme
            emplacement et arrivaient donc a l'envers — mesure: `3, 2, 1`.

            `lastInsert` retient donc ou s'est pose le plan precedent, et l'appel
            suivant enchaine juste apres. Le repere est abandonne des que la
            piste change par un autre chemin (`clipCount`), pour qu'un import
            fait bien plus tard reparte de la tete de lecture.
          */
          const time = usePlaybackStore.getState().time;
          const clipCount = state.project.videoTrack.clips.length;

          /*
            La chaine n'est valable que si RIEN n'a bouge depuis l'appel
            precedent: ni le nombre de plans, ni la tete de lecture.

            Le compte seul ne suffisait pas. Apres avoir construit trois plans,
            le repere valait `{index: 3, clipCount: 3}` — ce qui correspondait
            encore au projet, si bien qu'un import fait PLUS TARD, tete deplacee
            au milieu, continuait d'ajouter a la fin. Retenir aussi le temps
            distingue la boucle d'un lot (tete immobile) d'un import ulterieur.
          */
          const chained =
            lastInsert !== null &&
            lastInsert.clipCount === clipCount &&
            lastInsert.time === time
              ? lastInsert.index
              : null;

          const at = clipIndexAt(state.project.videoTrack, time);
          const index =
            options?.index ?? chained ?? (at >= 0 ? at + 1 : undefined);

          const project = appendAssetToTimeline(state.project, asset, {
            ...options,
            index,
          });

          /*
            Les preferences d'import s'appliquent ICI, sur le plan qui vient
            d'etre ajoute.

            C'est le point de passage unique des imports — un fichier isole comme
            un lot de trente — donc le seul endroit ou le reglage a besoin d'etre
            branche. Le faire dans `appendAssetToTimeline` melangerait une
            preference d'application a une fonction de domaine pure.
          */
          const preferences = usePreferencesStore.getState().importPreferences;
          const clips = project.videoTrack.clips;
          // Le plan ajoute n'est plus forcement le dernier: on vise son rang.
          const position = index === undefined ? clips.length - 1 : Math.min(index, clips.length - 1);
          const added = clips[position];
          if (!added) return { project };

          const framed = applyImportPreferences(
            added,
            asset.width !== undefined && asset.height !== undefined
              ? { width: asset.width, height: asset.height }
              : undefined,
            project.frame,
            preferences,
            options?.focal,
          );

          /*
            Repere pour l'appel suivant du meme lot.

            `clipCount` est le nombre de plans APRES cette insertion — donc
            exactement ce que le prochain appel lira AVANT la sienne. L'egalite
            prouve alors que personne n'a touche la piste entre les deux, et le
            lot peut enchainer. Retenir le compte d'avant les rendait toujours
            differents d'une unite: la chaine ne se formait jamais et les
            fichiers repartaient a l'envers.
          */
          lastInsert = { index: position + 1, clipCount: clips.length, time };

          return {
            project: {
              ...project,
              videoTrack: {
                ...project.videoTrack,
                clips: clips.map((clip, i) => (i === position ? framed : clip)),
              },
            },
          };
        }),

      removeAsset: (assetId) =>
        set((state) =>
          produce(state, (draft) => {
            delete draft.project.assets[assetId];
            draft.project.videoTrack.clips = draft.project.videoTrack.clips.filter(
              (clip) => clip.assetId !== assetId,
            );
            draft.project.audioTracks = draft.project.audioTracks.filter(
              (track) => track.assetId !== assetId,
            );
            draft.project.updatedAt = Date.now();
          }),
        ),

      addClip: (asset, index) =>
        set((state) => {
          const { project } = state;
          const withAsset = project.assets[asset.id] ? project : addAsset(project, asset);
          const clip = createClipForAsset(asset);
          const videoTrack =
            index === undefined
              ? appendClip(withAsset.videoTrack, clip, project.frame.fps)
              : insertClip(withAsset.videoTrack, clip, index, project.frame.fps);
          return { project: touched({ ...withAsset, videoTrack }) };
        }),

      removeClip: (clipId, options) =>
        set((state) => {
          const { project } = state;
          // Piste verrouillee: la suppression est refusee. On renvoie l'etat tel
          // quel plutot que de lever — l'appelant est un geste d'interface, et
          // une exception y serait ingerable.
          if (project.videoTrack.locked === true) return state;

          const removed = project.videoTrack.clips.find((clip) => clip.id === clipId);
          if (!removed) return state;

          const leaveGap = options?.leaveGap === true;
          const videoTrack = removeClip(project.videoTrack, clipId, project.frame.fps, {
            leaveGap,
          });

          /*
            Supprimer EN LAISSANT UN VIDE ne decale rien par definition: ni les
            plans suivants, ni le son, ni le texte. L'aimant ne s'applique donc
            pas — il n'arbitre que le rattrapage d'un decalage qui n'existe pas.
          */
          if (leaveGap) {
            return { project: touched({ ...project, videoTrack }) };
          }

          /**
           * L'aimant fait SUIVRE le son et le texte, il ne les laisse pas sur
           * place.
           *
           * Verifie par le calcul: un son cale sur un plan situe a 4 s, quand on
           * supprime 2 s avant lui, doit se retrouver a 2 s — la ou son image est
           * desormais. Ne rien faire le laisserait a 4 s pendant que l'image
           * remonte a 2 s: c'est exactement la desynchronisation constatee.
           *
           * L'aimant est donc ACTIF par defaut, et c'est le desactiver qui
           * fige l'audio a sa position absolue — utile quand la musique doit
           * rester calee sur sa propre grille rythmique quoi qu'il arrive a
           * l'image.
           */
          if (project.videoTrack.magnet === false) {
            return { project: touched({ ...project, videoTrack }) };
          }

          const from = removed.start;
          const freed = removed.duration;
          const audioTracks = project.audioTracks.map((track) =>
            track.start >= from
              ? { ...track, start: Math.max(0, track.start - freed) }
              : track,
          );

          // Les textes suivent la meme regle: ils sont cales sur l'image.
          const overlays = project.overlays.map((overlay) =>
            overlay.start >= from
              ? { ...overlay, start: Math.max(0, overlay.start - freed) }
              : overlay,
          );

          const lyrics = project.lyrics
            ? {
                ...project.lyrics,
                lines: project.lyrics.lines.map((line) =>
                  line.start >= from
                    ? { ...line, start: Math.max(0, line.start - freed) }
                    : line,
                ),
              }
            : undefined;

          return {
            project: touched({ ...project, videoTrack, audioTracks, overlays, lyrics }),
          };
        }),

      setTrackLocked: (track, locked) =>
        set((state) => {
          const { project } = state;
          if (track === 'video') {
            return { project: touched({ ...project, videoTrack: { ...project.videoTrack, locked } }) };
          }
          if (track === 'text') {
            return {
              project: touched({
                ...project,
                textTrack: { ...project.textTrack, locked },
              }),
            };
          }
          return state;
        }),

      setAudioTrackFlags: (trackId, patch) =>
        set((state) =>
          produce(state, (draft) => {
            const found = draft.project.audioTracks.find((t) => t.id === trackId);
            if (!found) return;
            Object.assign(found, patch);
            draft.project.updatedAt = Date.now();
          }),
        ),

      setTextTrackMagnet: (magnet) =>
        set((state) => ({
          project: touched({
            ...state.project,
            textTrack: { ...state.project.textTrack, magnet },
          }),
        })),

      setVideoTrackMagnet: (magnet) =>
        set((state) => ({
          project: touched({
            ...state.project,
            videoTrack: { ...state.project.videoTrack, magnet },
          }),
        })),

      moveClip: (from, to) =>
        set((state) =>
          isVideoLocked(state.project)
            ? state
            : {
                project: touched({
                  ...state.project,
                  videoTrack: moveClip(
                    state.project.videoTrack,
                    from,
                    to,
                    state.project.frame.fps,
                  ),
                }),
              },
        ),

      setClipDuration: (clipId, duration) =>
        set((state) =>
          isVideoLocked(state.project)
            ? state
            : {
                project: touched({
                  ...state.project,
                  videoTrack: setClipDuration(
                    state.project.videoTrack,
                    clipId,
                    duration,
                    state.project.frame.fps,
                  ),
                }),
              },
        ),

      trimStart: (clipId, delta) =>
        set((state) =>
          isVideoLocked(state.project)
            ? state
            : {
                project: touched({
                  ...state.project,
                  videoTrack: trimClipStart(
                    state.project.videoTrack,
                    clipId,
                    delta,
                    state.project.frame.fps,
                  ),
                }),
              },
        ),

      trimEnd: (clipId, delta) =>
        set((state) =>
          isVideoLocked(state.project)
            ? state
            : {
                project: touched({
                  ...state.project,
                  videoTrack: trimClipEnd(
                    state.project.videoTrack,
                    clipId,
                    delta,
                    state.project.frame.fps,
                  ),
                }),
              },
        ),

      updateClip: (clipId, patch) =>
        set((state) =>
          produce(state, (draft) => {
            if (isVideoLocked(draft.project)) return;
            const clip = draft.project.videoTrack.clips.find((c) => c.id === clipId);
            if (!clip) return;
            Object.assign(clip, patch);
            draft.project.updatedAt = Date.now();
          }),
        ),

      /**
       * Remplace le media d'un clip sans toucher a sa place ni a sa duree.
       *
       * C'est l'operation « remplacer cette image »: le montage rythmique deja
       * cale ne doit pas bouger. Pour une video, l'extrait source est reinitialise
       * puisque les bornes de l'ancien media n'ont aucun sens dans le nouveau.
       */
      replaceClipAsset: (clipId, asset) =>
        set((state) => {
          if (isVideoLocked(state.project)) return state;

          const withAsset = state.project.assets[asset.id]
            ? state.project
            : addAsset(state.project, asset);

          return {
            project: produce(withAsset, (draft) => {
              const clip = draft.videoTrack.clips.find((c) => c.id === clipId);
              if (!clip) return;

              clip.assetId = asset.id;

              if (asset.kind === 'video') {
                const sourceDuration = asset.duration ?? clip.duration;
                clip.source = { in: 0, out: sourceDuration, speed: 1 };
              } else {
                // Une image n'a pas d'extrait source: le laisser en place ferait
                // calculer un temps de source sur un media qui n'en a pas.
                clip.source = undefined;
              }

              draft.updatedAt = Date.now();
            }),
          };
        }),

      duplicateClip: (clipId) =>
        set((state) =>
          isVideoLocked(state.project)
            ? state
            : {
                project: touched({
                  ...state.project,
                  videoTrack: duplicateClip(
                    state.project.videoTrack,
                    clipId,
                    // L'identifiant est fourni par le store: le domaine reste pur.
                    newId('clip'),
                    state.project.frame.fps,
                  ),
                }),
              },
        ),

      setClipFilter: (clipId, filter) =>
        set((state) =>
          produce(state, (draft) => {
            if (isVideoLocked(draft.project)) return;
            const clip = draft.project.videoTrack.clips.find((c) => c.id === clipId);
            if (!clip) return;
            clip.filter = filter;
            draft.project.updatedAt = Date.now();
          }),
        ),

      setFilterPreset: (clipId, preset) =>
        set((state) =>
          produce(state, (draft) => {
            if (isVideoLocked(draft.project)) return;
            const clip = draft.project.videoTrack.clips.find((c) => c.id === clipId);
            if (!clip) return;
            if (preset === 'none') {
              clip.filter = undefined;
            } else {
              // L'intensite deja choisie est conservee en changeant de look:
              // la remettre a 1 defairait le dosage de l'utilisateur.
              const intensity = clip.filter?.intensity ?? 1;
              clip.filter = { ...filterForPreset(preset), intensity };
            }
            draft.project.updatedAt = Date.now();
          }),
        ),

      setFilterForAll: (filter) =>
        set((state) =>
          produce(state, (draft) => {
            draft.project.videoTrack.clips.forEach((clip) => {
              clip.filter = filter ? { ...filter } : undefined;
            });
            draft.project.updatedAt = Date.now();
          }),
        ),

      setTransition: (clipId, transition) =>
        set((state) =>
          produce(state, (draft) => {
            const clip = draft.project.videoTrack.clips.find((c) => c.id === clipId);
            if (!clip) return;
            clip.transitionIn = transition;
            draft.project.updatedAt = Date.now();
          }),
        ),

      setTransitionForAll: (transition) =>
        set((state) =>
          produce(state, (draft) => {
            // Le premier clip n'a pas de transition d'entree: il n'y a rien avant.
            draft.project.videoTrack.clips.forEach((clip, index) => {
              clip.transitionIn =
                index === 0 || !transition ? undefined : { ...transition };
            });
            draft.project.updatedAt = Date.now();
          }),
        ),

      setUniformDuration: (duration) =>
        set((state) => ({
          project: touched({
            ...state.project,
            videoTrack: setUniformDuration(
              state.project.videoTrack,
              duration,
              state.project.frame.fps,
            ),
          }),
        })),

      setMusic: (asset) =>
        set((state) => {
          const project = state.project.assets[asset.id]
            ? state.project
            : addAsset(state.project, asset);
          const track = createAudioTrack(asset, 'music');
          // Une seule piste musicale: la nouvelle remplace l'ancienne.
          const others = project.audioTracks.filter((t) => t.role !== 'music');
          return {
            project: touched({
              ...project,
              audioTracks: [track, ...others],
              // L'analyse rythmique porte sur l'ancienne musique: elle est perimee.
              beatMap: undefined,
            }),
          };
        }),

      addOriginalAudio: (asset, options) =>
        set((state) => {
          // Rien a extraire d'une image, ni d'une video muette.
          if (asset.kind !== 'video' || asset.hasAudio !== true) return state;

          const project = state.project.assets[asset.id]
            ? state.project
            : addAsset(state.project, asset);

          // Deja present: reappuyer ne doit pas empiler deux fois le meme son.
          const exists = project.audioTracks.some(
            (track) => track.role === 'original' && track.assetId === asset.id,
          );
          if (exists) return { project };

          const track = createAudioTrack(asset, 'original', { start: options?.start });
          return {
            project: touched({
              ...project,
              // Apres les pistes existantes: l'ordre du tableau n'affecte pas le
              // mixage, mais il rend la liste de l'interface previsible.
              audioTracks: [...project.audioTracks, track],
            }),
          };
        }),

      removeOriginalAudio: (assetId) =>
        set((state) => ({
          project: touched({
            ...state.project,
            audioTracks: state.project.audioTracks.filter(
              (track) => !(track.role === 'original' && track.assetId === assetId),
            ),
          }),
        })),

      updateAudioTrack: (trackId, patch) =>
        set((state) =>
          produce(state, (draft) => {
            // Le verrou lui-meme passe par `setAudioTrackFlags`: le bloquer ici
            // n'empeche donc pas de deverrouiller la piste.
            if (isAudioLocked(draft.project, trackId)) return;
            const track = draft.project.audioTracks.find((t) => t.id === trackId);
            if (!track) return;
            Object.assign(track, patch);
            draft.project.updatedAt = Date.now();
          }),
        ),

      removeAudioTrack: (trackId) =>
        set((state) =>
          produce(state, (draft) => {
            if (isAudioLocked(draft.project, trackId)) return;
            const removed = draft.project.audioTracks.find((t) => t.id === trackId);
            draft.project.audioTracks = draft.project.audioTracks.filter(
              (t) => t.id !== trackId,
            );
            if (removed?.role === 'music') draft.project.beatMap = undefined;
            draft.project.updatedAt = Date.now();
          }),
        ),

      setAudioRange: (trackId, range) =>
        set((state) =>
          isAudioLocked(state.project, trackId)
            ? state
            : {
                project: editAudioTrack(state.project, trackId, (track, duration) =>
                  setTrackRange(track, range, duration),
                ),
              },
        ),

      removeAudioRange: (trackId, from, to) =>
        set((state) =>
          isAudioLocked(state.project, trackId)
            ? state
            : {
                project: editAudioTrack(state.project, trackId, (track, duration) =>
                  removeRange(track, from, to, duration),
                ),
              },
        ),

      splitAtPlayhead: (at) =>
        set((state) => {
          const { project } = state;

          // 1. Le plan sous la tete de lecture.
          let videoTrack = project.videoTrack;
          // Piste verrouillee: on la laisse intacte.
          const clipIndex = videoTrack.locked === true ? -1 : clipIndexAt(videoTrack, at);
          if (clipIndex >= 0) {
            videoTrack = splitClipAt(videoTrack, at, newId('clip'), project.frame.fps);
          }

          /**
           * 2. Chaque piste audio traversee par la tete de lecture.
           *
           * `at` est un temps TIMELINE, alors que `splitAt` attend un temps de
           * SOURCE: on retranche donc le debut de la piste. Sans cette
           * conversion, une piste posee a 4,6 s se couperait 4,6 s trop loin
           * dans son fichier.
           */
          const audioTracks = project.audioTracks.map((track) => {
            // Piste verrouillee: aucune coupe.
            if (track.locked === true) return track;

            const asset = project.assets[track.assetId];
            if (!asset?.duration) return track;

            const intoTrack = at - track.start;
            const audible = trackDuration(track);
            // Hors de la piste: rien a couper.
            if (intoTrack <= 0 || intoTrack >= audible) return track;

            return splitAt(track, track.source.in + intoTrack, asset.duration);
          });

          /**
           * 3. Chaque incrustation de texte traversee.
           *
           * `flatMap`: une incrustation coupee devient deux entrees, les autres
           * restent telles quelles. `splitTextOverlay` renvoie `null` quand la
           * coupe est impossible, et l'incrustation passe alors inchangee.
           */
          const textLocked = project.textTrack?.locked === true;
          const overlays = textLocked
            ? project.overlays
            : project.overlays.flatMap((overlay) => {
                const pieces = splitTextOverlay(overlay, at, newId('text'));
                return pieces ?? [overlay];
              });

          /**
           * 4. Les lignes de paroles.
           *
           * Meme traitement, mais sur `lyrics.lines`: une ligne coupee garde son
           * texte sur les deux morceaux. Les mots horodates du karaoke sont
           * REPARTIS et non dupliques — sinon le surlignage du second morceau
           * repartirait du premier mot.
           */
          const lyrics = project.lyrics && !textLocked
            ? {
                ...project.lyrics,
                lines: project.lyrics.lines.flatMap((line) => {
                  const into = at - line.start;
                  if (into < MIN_TEXT_DURATION) return [line];
                  if (line.duration - into < MIN_TEXT_DURATION) return [line];

                  const words = line.words ?? [];
                  return [
                    {
                      ...line,
                      duration: into,
                      ...(words.length > 0
                        ? { words: words.filter((word) => word.start < at) }
                        : {}),
                    },
                    {
                      ...line,
                      id: newId('lyric'),
                      start: at,
                      duration: line.duration - into,
                      ...(words.length > 0
                        ? { words: words.filter((word) => word.start >= at) }
                        : {}),
                    },
                  ];
                }),
              }
            : undefined;

          const changed =
            videoTrack !== project.videoTrack ||
            audioTracks.some((track, index) => track !== project.audioTracks[index]) ||
            overlays.length !== project.overlays.length ||
            (lyrics?.lines.length ?? 0) !== (project.lyrics?.lines.length ?? 0);
          // Aucune coupe possible: on ne cree pas d'entree d'historique vide.
          if (!changed) return state;

          return {
            project: touched({ ...project, videoTrack, audioTracks, overlays, lyrics }),
          };
        }),

      splitAudio: (trackId, at) =>
        set((state) => ({
          project: editAudioTrack(state.project, trackId, (track, duration) =>
            splitAt(track, at, duration),
          ),
        })),

      /*
        Ces deux actions n'utilisent PAS `editAudioTrack`.

        Ce dernier passe par `applySegments`, donc par la normalisation: elle
        trie par borne source et fusionne les recouvrements, ce qui effacerait
        une copie et annulerait un deplacement. L'ordre des segments est ici
        l'ordre de LECTURE, il ne se recalcule pas.

        Le verrou de piste reste verifie a la main, puisqu'on court-circuite le
        point de passage qui s'en chargeait.
      */
      duplicateAudioSegment: (trackId, segmentId) =>
        set((state) => {
          if (isAudioLocked(state.project, trackId)) return state;
          const track = state.project.audioTracks.find((entry) => entry.id === trackId);
          if (!track) return state;

          const updated = duplicateSegment(track, segmentId);
          if (updated === track) return state;

          return {
            project: touched({
              ...state.project,
              audioTracks: state.project.audioTracks.map((entry) =>
                entry.id === trackId ? updated : entry,
              ),
            }),
          };
        }),

      moveAudioSegment: (trackId, segmentId, direction) =>
        set((state) => {
          if (isAudioLocked(state.project, trackId)) return state;
          const track = state.project.audioTracks.find((entry) => entry.id === trackId);
          if (!track) return state;

          const updated = moveSegment(track, segmentId, direction);
          if (updated === track) return state;

          return {
            project: touched({
              ...state.project,
              audioTracks: state.project.audioTracks.map((entry) =>
                entry.id === trackId ? updated : entry,
              ),
            }),
          };
        }),

      removeAudioSegment: (trackId, segmentId, options) =>
        set((state) => ({
          project: editAudioTrack(state.project, trackId, (track, duration) =>
            removeSegment(track, segmentId, duration, options ?? {}),
          ),
        })),

      updateAudioSegment: (trackId, segmentId, patch) =>
        set((state) => ({
          project: editAudioTrack(state.project, trackId, (track, duration) =>
            updateSegment(track, segmentId, patch, duration),
          ),
        })),

      setAudioOffset: (trackId, start) =>
        set((state) =>
          produce(state, (draft) => {
            if (isAudioLocked(draft.project, trackId)) return;
            const track = draft.project.audioTracks.find((t) => t.id === trackId);
            if (!track) return;
            // Un decalage negatif ferait commencer la musique avant le reel:
            // la portion serait inaudible et la grille des beats fausse.
            track.start = Math.max(0, start);
            draft.project.updatedAt = Date.now();
          }),
        ),

      addText: (text, options) => {
        const overlay = createTextOverlay(text, options);
        set((state) =>
          produce(state, (draft) => {
            if (isTextLocked(draft.project)) return;
            draft.project.overlays.push(overlay);
            draft.project.updatedAt = Date.now();
          }),
        );
        return overlay.id;
      },

      updateText: (overlayId, patch) =>
        set((state) =>
          produce(state, (draft) => {
            if (isTextLocked(draft.project)) return;
            const overlay = draft.project.overlays.find((o) => o.id === overlayId);
            if (!overlay) return;
            Object.assign(overlay, patch);
            draft.project.updatedAt = Date.now();
          }),
        ),

      addTextMask: (text, options) => {
        const mask = createTextMask(text, options);
        set((state) =>
          produce(state, (draft) => {
            if (isTextLocked(draft.project)) return;
            // `textMasks` est optionnel: un projet enregistre avant les masques
            // n'en a pas, et le lire sans le creer laisserait le push sans cible.
            draft.project.textMasks = [...(draft.project.textMasks ?? []), mask];
            draft.project.updatedAt = Date.now();
          }),
        );
        return mask.id;
      },

      updateTextMask: (maskId, patch) =>
        set((state) =>
          produce(state, (draft) => {
            if (isTextLocked(draft.project)) return;
            const mask = draft.project.textMasks?.find((m) => m.id === maskId);
            if (!mask) return;
            Object.assign(mask, patch);
            draft.project.updatedAt = Date.now();
          }),
        ),

      removeTextMask: (maskId) =>
        set((state) =>
          produce(state, (draft) => {
            if (isTextLocked(draft.project)) return;
            if (!draft.project.textMasks) return;
            draft.project.textMasks = draft.project.textMasks.filter((m) => m.id !== maskId);
            draft.project.updatedAt = Date.now();
          }),
        ),

      setTextPreset: (overlayId, preset) =>
        set((state) =>
          produce(state, (draft) => {
            if (isTextLocked(draft.project)) return;
            const overlay = draft.project.overlays.find((o) => o.id === overlayId);
            if (!overlay) return;
            // Le preset redefinit le style mais conserve la couleur choisie.
            const previousColor = overlay.style.color;
            overlay.style = { ...textStyleForPreset(preset), color: previousColor };
            draft.project.updatedAt = Date.now();
          }),
        ),

      removeText: (overlayId, options) =>
        set((state) => {
          const { project } = state;
          // Piste texte verrouillee: suppression refusee.
          if (project.textTrack?.locked === true) return state;

          const removed = project.overlays.find((o) => o.id === overlayId);
          if (!removed) return state;

          let overlays = project.overlays.filter((o) => o.id !== overlayId);

          /**
           * On referme le vide: les incrustations SUIVANTES remontent de la
           * duree liberee.
           *
           * `leaveGap` tranche pour CETTE suppression; a defaut, l'aimant de la
           * piste decide. Il est inactif par defaut pour le texte, a l'inverse
           * de l'audio: un texte est pose a un instant choisi pour tomber sur
           * une image ou une parole, et recoller deplacerait des textes cales a
           * la main.
           */
          const closeGap =
            options?.leaveGap === undefined
              ? project.textTrack?.magnet === true
              : options.leaveGap === false;

          if (closeGap) {
            const from = removed.start;
            const freed = removed.duration;
            overlays = overlays.map((overlay) =>
              overlay.start >= from
                ? { ...overlay, start: Math.max(0, overlay.start - freed) }
                : overlay,
            );
          }

          return { project: touched({ ...project, overlays }) };
        }),

      setTextFont: (overlayId, font) =>
        set((state) =>
          produce(state, (draft) => {
            if (isTextLocked(draft.project)) return;
            const overlay = draft.project.overlays.find((o) => o.id === overlayId);
            if (!overlay) return;
            overlay.style = withFont(overlay.style, font);
            draft.project.updatedAt = Date.now();
          }),
        ),

      /**
       * Remplace les paroles a partir d'un texte colle.
       *
       * Le calage se fait sur la grille rythmique quand elle existe. Sans
       * analyse, `alignLyricsToBeats` repartit regulierement: c'est moins juste,
       * mais l'utilisateur voit tout de suite ses paroles et peut ajuster.
       */
      setLyricsFromText: (raw, options) => {
        const { project } = get();
        // Ces actions ecrivent via `set` sans passer par `produce`: la garde
        // doit donc etre posee explicitement ici.
        if (isTextLocked(project)) return;
        const texts = parseLyricLines(raw);
        const base = completeLyrics(project.lyrics ?? createLyrics());

        if (texts.length === 0) {
          set({ project: touched({ ...project, lyrics: undefined }) });
          return;
        }

        const lines = alignLyricsToBeats(texts, currentGrid(project), {
          beatsPerLine: base.beatsPerLine,
          startAt: options?.startAt ?? 0,
          until: videoDuration(project.videoTrack),
        });

        set({ project: touched({ ...project, lyrics: { ...base, lines } }) });
      },

      setLyricsLines: (lines) => {
        const { project } = get();
        // Ces actions ecrivent via `set` sans passer par `produce`: la garde
        // doit donc etre posee explicitement ici.
        if (isTextLocked(project)) return;
        const base = completeLyrics(project.lyrics ?? createLyrics());

        if (lines.length === 0) {
          set({ project: touched({ ...project, lyrics: undefined }) });
          return;
        }

        // Le calage vient de la source et fait autorite: aucun recalcul ici.
        set({ project: touched({ ...project, lyrics: { ...base, lines: [...lines] } }) });
      },

      updateLyrics: (patch) =>
        set((state) =>
          produce(state, (draft) => {
            if (isTextLocked(draft.project)) return;
            if (!draft.project.lyrics) return;
            Object.assign(draft.project.lyrics, patch);
            draft.project.updatedAt = Date.now();
          }),
        ),

      setLyricsFont: (font) =>
        set((state) =>
          produce(state, (draft) => {
            const { lyrics } = draft.project;
            if (!lyrics) return;
            lyrics.style = withFont(lyrics.style, font);
            draft.project.updatedAt = Date.now();
          }),
        ),

      updateLyricLine: (lineId, patch) =>
        set((state) =>
          produce(state, (draft) => {
            if (isTextLocked(draft.project)) return;
            const line = draft.project.lyrics?.lines.find((l) => l.id === lineId);
            if (!line) return;
            Object.assign(line, patch);
            draft.project.updatedAt = Date.now();
          }),
        ),

      removeLyricLine: (lineId) =>
        set((state) =>
          produce(state, (draft) => {
            if (isTextLocked(draft.project)) return;
            const { lyrics } = draft.project;
            if (!lyrics) return;
            lyrics.lines = lyrics.lines.filter((line) => line.id !== lineId);
            // Plus aucune ligne: on retire les paroles pour que l'interface
            // repasse a l'etat vide au lieu d'afficher un editeur inerte.
            if (lyrics.lines.length === 0) draft.project.lyrics = undefined;
            draft.project.updatedAt = Date.now();
          }),
        ),

      /** Recale les lignes existantes: utile apres une nouvelle analyse rythmique. */
      realignLyrics: (options) => {
        const { project } = get();
        if (isTextLocked(project)) return;
        if (!project.lyrics) return;

        const lines = alignLyricsToBeats(
          project.lyrics.lines.map((line) => line.text),
          currentGrid(project),
          {
            beatsPerLine: project.lyrics.beatsPerLine,
            startAt: options?.startAt ?? 0,
            until: videoDuration(project.videoTrack),
          },
        );

        set({
          project: touched({ ...project, lyrics: { ...project.lyrics, lines } }),
        });
      },

      clearLyrics: () =>
        set((state) =>
          isTextLocked(state.project)
            ? state
            : { project: touched({ ...state.project, lyrics: undefined }) },
        ),

      setBeatMap: (beatMap) =>
        set((state) => ({ project: touched({ ...state.project, beatMap }) })),

      setSnapping: (patch) =>
        set((state) => ({
          project: touched({
            ...state.project,
            snapping: { ...state.project.snapping, ...patch },
          }),
        })),

      distributeOnBeats: (options) => {
        const { project } = get();
        if (!project.beatMap) return;

        /*
          Le critere decide de la grille. `beat` garde la division choisie; les
          autres sont des instants precis, sans subdivision possible.
        */
        const grid = featureGrid(
          project.beatMap,
          musicTrack(project),
          project.snapping.division,
          options?.criterion ?? 'beat',
        );
        // Aucun instant pour ce critere: on ne touche pas au montage plutot que de
        // tout empiler sur zero.
        if (grid.length === 0) return;

        set({
          project: touched({
            ...project,
            videoTrack: distributeTrackOnBeats(project.videoTrack, grid, {
              division: project.snapping.division,
              mode: options?.mode ?? 'each',
              n: options?.n ?? 1,
              fps: project.frame.fps,
            }),
          }),
        });
      },

      quantizeCuts: () => {
        const { project } = get();
        if (!project.beatMap) return;

        const grid = timelineGrid(
          project.beatMap,
          musicTrack(project),
          project.snapping.division,
        );
        const tolerance = defaultTolerance(project.beatMap, project.snapping.division);

        set({
          project: touched({
            ...project,
            videoTrack: quantizeTrackBoundaries(
              project.videoTrack,
              grid,
              tolerance,
              project.frame.fps,
            ),
          }),
        });
      },
    }),
    {
      limit: 50,
      // `updatedAt` change a chaque mutation: l'inclure dans l'egalite ferait
      // enregistrer un etat d'historique pour chaque frappe au clavier.
      equality: (a, b) =>
        a.project.videoTrack === b.project.videoTrack &&
        a.project.audioTracks === b.project.audioTracks &&
        a.project.overlays === b.project.overlays &&
        a.project.lyrics === b.project.lyrics &&
        a.project.assets === b.project.assets &&
        a.project.name === b.project.name &&
        a.project.beatMap === b.project.beatMap &&
        a.project.snapping === b.project.snapping,
    },
  ),
);

/** Accès a l'historique (annuler / rétablir). */
export const useProjectHistory = () => useProjectStore.temporal;
