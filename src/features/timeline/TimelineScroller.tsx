/**
 * Conteneur de la timeline: assemble la regle des beats et la bande de clips,
 * et porte les gestes de scrub et de zoom.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { BeatRuler } from './BeatRuler';
import { ClipStrip } from './ClipStrip';
import { AudioStrip } from './AudioStrip';
import { TextStrip } from './TextStrip';
import { useScrubGesture, usePinchZoom, useTimelineGeometry } from './useTimelineGestures';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { useProjectStore } from '../../store/useProjectStore';
import {
  DEFAULT_PX_PER_SECOND,
  MAX_PX_PER_SECOND,
  MIN_PX_PER_SECOND,
  useUiStore,
} from '../../store/useUiStore';
import { clipIndexAt, videoDuration } from '../../domain/timeline';
import { musicTrack } from '../../domain/project';
import { defaultTolerance, snapTime, timelineGrid } from '../../domain/snapping';
import { MIN_CLIP_DURATION } from '../../domain/types';
import { MIN_TEXT_DURATION } from '../../domain/project';
import { MIN_SEGMENT_DURATION, trackDuration, trackSegments } from '../../domain/audioEdit';
import { CloseIcon, ScissorsIcon } from '../../components/ui/icons';
import { CONTROLS_W } from './TrackControls';

/** Facteur de zoom applique a chaque pression sur + ou -. */
const ZOOM_STEP = 1.5;

/** Duree d'appui avant que les ciseaux apparaissent, en millisecondes. */
const LONG_PRESS_MS = 450;

export function TimelineScroller() {
  const { t } = useTranslation('editor');
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  const project = useProjectStore((state) => state.project);
  const duration = videoDuration(project.videoTrack);
  const geometry = useTimelineGeometry(duration, viewportWidth);

  const pxPerSecond = useUiStore((state) => state.pxPerSecond);
  const setPxPerSecond = useUiStore((state) => state.setPxPerSecond);

  // Mesure de la largeur visible: toute la geometrie en depend.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const measure = () => setViewportWidth(element.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Aimantation du scrub sur la grille rythmique. */
  const snapPlayhead = useMemo(() => {
    if (!project.snapping.enabled || !project.beatMap) return undefined;
    const grid = timelineGrid(project.beatMap, musicTrack(project), project.snapping.division);
    const tolerance = defaultTolerance(project.beatMap, project.snapping.division);
    return (time: number) => snapTime(grid, time, tolerance);
    // Idem: `project` suffit, les champs en derivent.
  }, [project]);

  const bindScrub = useScrubGesture({ geometry, snap: snapPlayhead });
  const bindPinch = usePinchZoom(geometry);

  const splitAtPlayhead = useProjectStore((state) => state.splitAtPlayhead);

  /**
   * Position centrale, lue hors de React.
   *
   * Pendant la lecture et le scrub, le temps change a chaque frame. Un abonnement
   * direct evite de re-rendre l'arbre de la timeline 60 fois par seconde: seul ce
   * composant recalcule sa transformation.
   */
  const centerTime = useSyncExternalStore(
    (listener) => usePlaybackStore.subscribe(listener),
    () => usePlaybackStore.getState().time,
  );

  /**
   * Ciseaux reveles par un appui long, doigt IMMOBILE.
   *
   * `ClipStrip` utilise un appui long plus court (250 ms) pour basculer en
   * reordonnancement, mais il exige un GLISSEMENT: les deux gestes ne se
   * disputent donc pas le doigt. Un appui immobile ouvre les ciseaux, un appui
   * suivi d'un mouvement deplace le clip — et le seuil de 8 px ci-dessous est
   * precisement ce qui tranche entre les deux.
   */
  const [splitHintVisible, setSplitHintVisible] = useState(false);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOrigin = useRef({ x: 0, y: 0 });

  const cancelLongPress = () => {
    if (longPress.current !== null) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
  };

  /**
   * Une fois ouverts, les ciseaux ne se referment QUE sur la croix.
   *
   * Ni le scrub, ni une coupe, ni l'attente ne les escamotent. Les deux
   * versions precedentes les retiraient automatiquement — au bout de quelques
   * secondes, puis des que le doigt faisait defiler la timeline — et dans les
   * deux cas ils disparaissaient exactement au moment ou l'on s'en servait:
   * on fait defiler POUR placer le trait a l'endroit de la coupe.
   *
   * Un outil qu'on a explicitement sorti se range explicitement.
   */

  /**
   * Y a-t-il quelque chose a couper sous la tete de lecture ?
   *
   * Derive de `centerTime`, qui vient deja de l'abonnement direct: le bouton se
   * grise donc en temps reel pendant le scrub, sans re-rendre l'arbre.
   *
   * On exige que les DEUX morceaux restent exploitables — c'est la meme regle que
   * `splitClipAt`, et sans elle le bouton paraitrait actif alors qu'un appui ne
   * ferait rien.
   */
  const canSplit = useMemo(() => {
    /**
     * On interroge CHAQUE piste, pas seulement l'image.
     *
     * Une premiere version ne regardait que la piste video: verrouiller l'image
     * grisait donc les ciseaux et interdisait de couper l'audio, alors que le
     * verrou ne devait proteger que la piste concernee.
     */
    const { videoTrack, audioTracks, overlays, lyrics, textTrack } = project;

    if (videoTrack.locked !== true) {
      const index = clipIndexAt(videoTrack, centerTime);
      if (index >= 0) {
        const clip = videoTrack.clips[index]!;
        const into = centerTime - clip.start;
        if (into >= MIN_CLIP_DURATION && clip.duration - into >= MIN_CLIP_DURATION) {
          return true;
        }
      }
    }

    /**
     * Une piste audio traversee et deverrouillee suffit — mais il faut poser
     * ici EXACTEMENT la question que `splitAt` tranchera.
     *
     * Une version precedente se contentait de « la tete est quelque part dans la
     * piste » (`into > 0`). Or `splitAt` travaille SEGMENT par segment et exige
     * `MIN_SEGMENT_DURATION` de part et d'autre: sur une piste deja decoupee en
     * plusieurs passages, les ciseaux s'allumaient donc au voisinage de chaque
     * frontiere interne alors qu'aucune coupe n'etait possible. Un bouton actif
     * qui ne fait rien est pire qu'un bouton grise.
     */
    const audioCuttable = audioTracks.some((track) => {
      if (track.locked === true) return false;
      const into = centerTime - track.start;
      if (into <= 0 || into >= trackDuration(track)) return false;

      // `into` est un temps de piste; les segments sont en temps de SOURCE.
      const atSource = track.source.in + into;
      return trackSegments(track).some(
        (segment) =>
          atSource > segment.in + MIN_SEGMENT_DURATION &&
          atSource < segment.out - MIN_SEGMENT_DURATION,
      );
    });
    if (audioCuttable) return true;

    if (textTrack?.locked === true) return false;

    const spans = [
      ...overlays.map((o) => ({ start: o.start, duration: o.duration })),
      ...(lyrics?.lines ?? []).map((l) => ({ start: l.start, duration: l.duration })),
    ];
    return spans.some((span) => {
      const into = centerTime - span.start;
      return into >= MIN_TEXT_DURATION && span.duration - into >= MIN_TEXT_DURATION;
    });
  }, [project, centerTime]);

  return (
    <div
      ref={containerRef}
      {...bindScrub()}
      {...bindPinch()}
      // `touch-none` est indispensable: sans lui, le navigateur intercepte le
      // glissement pour son propre defilement et le scrub devient erratique.
      // Le montage est pose sur une surface distincte de l'apercu: c'est ce qui
      // le fait lire comme une zone de travail et non comme la suite de l'image.
      className="relative flex shrink-0 touch-none select-none flex-col bg-ink-950"
      onPointerDown={(event) => {
        pressOrigin.current = { x: event.clientX, y: event.clientY };
        cancelLongPress();
        longPress.current = setTimeout(() => {
          longPress.current = null;
          setSplitHintVisible(true);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(event) => {
        // Un glissement est un scrub, pas un appui long: on annule le minuteur
        // des que le doigt bouge de plus de quelques pixels.
        const dx = Math.abs(event.clientX - pressOrigin.current.x);
        const dy = Math.abs(event.clientY - pressOrigin.current.y);
        if (dx > 8 || dy > 8) {
          cancelLongPress();
          /*
            Des ciseaux DEJA ouverts restent ouverts pendant le scrub.

            Une version precedente les refermait ici, en supposant qu'un scrub
            annulait l'intention de couper. C'est l'inverse: on fait defiler
            precisement POUR amener le trait a l'endroit ou l'on veut couper, et
            les ciseaux disparaissaient donc au moment ou ils devenaient utiles.
            Seule la croix — ou l'inactivite — les referme desormais.
          */
        }
      }}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
    >
      <BeatRuler
        pxPerSecond={geometry.pxPerSecond}
        viewportWidth={viewportWidth}
        /*
          La regle affiche la meme fenetre que les bandes.

          Son canevas commence au bord gauche du conteneur, alors que les bandes
          sont decalees de `CONTROLS_W`: on retranche donc cette largeur ici
          aussi, faute de quoi les ticks de beat tombaient 44 px a cote des
          clips qu'ils sont censes rythmer.
        */
        scrollTime={
          centerTime - (CONTROLS_W + viewportWidth / 2) / geometry.pxPerSecond
        }
      />
      <ClipStrip geometry={geometry} centerTime={centerTime} />
      {/* Les pistes audio sous les clips: on voit enfin OU un son commence, et
          on peut le deplacer au doigt pour le caler sur une image. */}
      <AudioStrip geometry={geometry} centerTime={centerTime} />
      <TextStrip geometry={geometry} centerTime={centerTime} />

      {/*
        Ciseaux: coupe TOUT ce que la tete de lecture traverse — le plan, chaque
        piste audio et le texte — en une seule action, donc un seul « Annuler ».

        Pose SUR LE TRAIT de la tete de lecture et revele par un APPUI LONG.
        Deux raisons de ne pas l'afficher en permanence: sur 390 px un bouton
        fixe mange la place du montage, et son ancienne position en bas a gauche
        etait entierement recouverte par la colonne de commandes des pistes — il
        existait dans le DOM sans qu'aucun clic ne l'atteigne (mesure:
        `elementFromPoint` renvoyait un cadenas).
      */}
      {splitHintVisible && (
        // Pose sur le trait, donc au meme point que lui — pas au milieu
        // geometrique, qui en est decale de `CONTROLS_W`.
        <div
          className="pointer-events-none absolute inset-y-0 z-30 flex -translate-x-1/2 items-center gap-1.5"
          style={{ left: CONTROLS_W + viewportWidth / 2 }}
        >
          <button
            type="button"
            aria-label={t('timeline.split')}
            /**
             * Grise plutot que retire quand il n'y a rien a couper.
             *
             * Le faire disparaitre ferait aussi disparaitre la croix posee a
             * cote, et un scrub qui traverse un bord ferait clignoter les deux
             * boutons — on garde donc une cible stable sous le doigt.
             */
            disabled={!canSplit}
            /**
             * `onPointerDown` et non `onClick`.
             *
             * Le geste de scrub de la timeline appelle `event.preventDefault()`
             * sur sa premiere frame, ce qui supprime le `click` de synthese: le
             * bouton etait bien au premier plan et repondait a un `.click()`
             * programmatique, mais un vrai doigt ne declenchait rien. On ecoute
             * donc le pointeur, et on stoppe la propagation pour que le scrub ne
             * s'empare pas du geste.
             */
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              if (!canSplit) return;
              splitAtPlayhead(usePlaybackStore.getState().time);
              /*
                Les ciseaux RESTENT ouverts: on decoupe rarement une seule fois,
                et refermer a chaque coupe imposait un nouvel appui long pour
                chacune. Seule la croix les referme.
              */
            }}
            className={[
              'pointer-events-auto flex size-11 items-center justify-center rounded-full',
              'border-2 border-beat-400 bg-ink-950/95 text-beat-400 shadow-lg',
              'backdrop-blur-sm active:bg-ink-800 [&>svg]:size-5',
              'disabled:opacity-60',
            ].join(' ')}
          >
            <ScissorsIcon />
          </button>

          {/*
            Croix de fermeture: sans elle, les ciseaux ne se refermaient qu'en
            attendant l'expiration du minuteur ou en faisant defiler la timeline
            — deux facons detournees de dire « j'ai fini ».

            Volontairement neutre (`ink`) et non rouge: elle range un outil, elle
            ne detruit rien.
          */}
          <button
            type="button"
            aria-label={t('timeline.splitDone')}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              setSplitHintVisible(false);
            }}
            className="pointer-events-auto flex size-11 items-center justify-center rounded-full border border-ink-600 bg-ink-950/95 text-ink-300 shadow-lg backdrop-blur-sm active:bg-ink-800 [&>svg]:size-4"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {/*
        Boutons de zoom: overlay en bas a droite de la zone de timeline.
        `pointer-events-none` sur le conteneur pour que les gestes de scrub
        et de pinch passent a travers; `pointer-events-auto` sur les boutons
        eux-memes pour qu'ils restent cliquables.
      */}
      <div
        className="pointer-events-none absolute bottom-1 right-1 z-10 flex items-center gap-0.5"
        // Meme isolation que la colonne de commandes: sans elle, le scrub prend
        // le pointeur au `pointerdown` et les boutons de zoom ne recoivent
        // jamais leur clic a la souris.
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label={t('timeline.zoomOut')}
          disabled={pxPerSecond <= MIN_PX_PER_SECOND}
          // `pointerdown` et non `click`: le scrub prend le pointeur avant que
          // le clic de synthese n'arrive. Cf. `TrackControls`.
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            if (pxPerSecond > MIN_PX_PER_SECOND) setPxPerSecond(pxPerSecond / ZOOM_STEP);
          }}
          className={[
            'pointer-events-auto flex h-7 w-7 items-center justify-center',
            'rounded-l-md border border-ink-600 bg-ink-900/90 text-sm font-bold',
            'text-ink-300 backdrop-blur-sm transition-opacity active:bg-ink-700',
            'disabled:cursor-not-allowed disabled:opacity-30',
          ].join(' ')}
        >
          −
        </button>

        {/* Pourcentage par rapport au zoom par defaut. */}
        <span
          aria-label={t('timeline.zoom')}
          className="pointer-events-none flex h-7 min-w-[3rem] items-center justify-center border-y border-ink-600 bg-ink-900/90 px-1 text-[10px] font-medium tabular-nums text-ink-400 backdrop-blur-sm"
        >
          {Math.round((pxPerSecond / DEFAULT_PX_PER_SECOND) * 100)}%
        </span>

        <button
          type="button"
          aria-label={t('timeline.zoomIn')}
          disabled={pxPerSecond >= MAX_PX_PER_SECOND}
          // Idem: `pointerdown`, sinon le scrub avale le clic a la souris.
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            if (pxPerSecond < MAX_PX_PER_SECOND) setPxPerSecond(pxPerSecond * ZOOM_STEP);
          }}
          className={[
            'pointer-events-auto flex h-7 w-7 items-center justify-center',
            'rounded-r-md border border-ink-600 bg-ink-900/90 text-sm font-bold',
            'text-ink-300 backdrop-blur-sm transition-opacity active:bg-ink-700',
            'disabled:cursor-not-allowed disabled:opacity-30',
          ].join(' ')}
        >
          +
        </button>
      </div>
    </div>
  );
}
