/**
 * Apercu 9:16.
 *
 * Le canvas est dimensionne en CSS par la grille parente, et son backing store
 * est calcule ici en pixels physiques (plafonnes a 720 de large): rendre en 1080
 * pour un affichage de 236 px gaspillerait de la batterie sans gain visible.
 *
 * Le rendu passe par `Player`, qui appelle `Compositor.draw` — exactement le
 * meme chemin que l'export.
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Player } from '../../engine/Player';
import { useMedia } from './MediaProvider';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import { ExpandIcon } from '../../components/ui/icons';
import { useCropGesture } from './useCropGesture';
import { useFraming } from './useFraming';
import { FramingGuides } from './FramingGuides';
import { PreviewZoom } from './PreviewZoom';

/** Resolution maximale du backing store de l'apercu. */
const MAX_PREVIEW_WIDTH = 720;

export function PreviewCanvas() {
  const { t } = useTranslation('editor');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);

  const project = useProjectStore((state) => state.project);
  const { cache, audioBuffers, audioContext, readyRevision } = useMedia();

  const setTime = usePlaybackStore((state) => state.setTime);
  const setPlaying = usePlaybackStore((state) => state.setPlaying);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const rate = usePlaybackStore((state) => state.rate);

  const fullscreen = useUiStore((state) => state.fullscreen);
  const setFullscreen = useUiStore((state) => state.setFullscreen);

  const hasClips = project.videoTrack.clips.length > 0;

  // Recadrage direct au doigt. Desactive pendant la lecture: pincer une image
  // qui defile ne veut rien dire, et le geste entrerait en concurrence avec le
  // tap qui met en pause.
  const crop = useCropGesture(hasClips && !isPlaying);

  /*
    Reperes de cadrage: sur demande, et seulement a l'arret.

    Deux conditions, pour deux raisons distinctes. Le reglage d'abord: un `cover`
    deborde par construction, donc le bandeau s'affichait en permanence sur un
    montage normal et masquait le bas de l'image. C'est un outil qu'on ouvre
    quand on cadre, pas un decor.

    L'arret ensuite: pendant la lecture les reperes clignoteraient a chaque
    coupe, et ils servent a AJUSTER — ce qu'on ne fait pas en regardant defiler.
    Les masquer evite aussi de re-rendre cet arbre soixante fois par seconde.
  */
  const showFramingGuides = usePreferencesStore(
    (state) => state.importPreferences.showFramingGuides,
  );
  const framing = useFraming(project, showFramingGuides && !isPlaying);

  /**
   * Creation du lecteur, UNE SEULE FOIS.
   *
   * Les dependances sont volontairement reduites a ce qui est stable pour la
   * duree de vie de l'editeur. En particulier `audioBuffers` en est exclu:
   * l'inclure detruisait et recreait le lecteur a chaque decodage audio, et le
   * nouveau lecteur repartait d'un projet vide — l'apercu restait noir. Les
   * buffers sont pousses par un effet dedie (`setAudioBuffers`).
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const player = new Player(
      audioContext,
      canvas,
      cache,
      useProjectStore.getState().project,
      // Etat courant lu a la construction; les mises a jour passent ensuite par
      // `setAudioBuffers`.
      new Map(),
      {
        // La position vient du lecteur, jamais l'inverse: c'est l'horloge audio
        // qui fait autorite.
        onTimeUpdate: setTime,
        onEnded: () => setPlaying(false),
      },
    );
    playerRef.current = player;
    player.refresh();

    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, [audioContext, cache, setTime, setPlaying]);

  // --- Dimensionnement du backing store.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return;

      const dpr = window.devicePixelRatio || 1;
      const width = Math.min(MAX_PREVIEW_WIDTH, Math.round(rect.width * dpr));
      // On derive la hauteur du ratio de la frame, pas du rectangle CSS: le
      // canvas doit rester exactement en 9:16 meme si la mise en page varie.
      const height = Math.round((width * project.frame.height) / project.frame.width);

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        playerRef.current?.refresh();
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [project.frame.width, project.frame.height]);

  // --- Propagation des changements de projet vers le lecteur.
  useEffect(() => {
    playerRef.current?.setProject(project);
  }, [project]);

  // Un media vient d'etre decode: on redessine. `readyRevision` est le seul
  // moyen de l'apprendre, un ImageBitmap n'etant pas un etat React.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    // On repousse aussi le projet: au premier rendu, le lecteur peut avoir ete
    // construit avant que le projet restaure ne soit dans le store.
    player.setProject(useProjectStore.getState().project);
    player.refresh();
  }, [readyRevision]);

  useEffect(() => {
    playerRef.current?.setAudioBuffers(audioBuffers);
  }, [audioBuffers]);

  // La vitesse d'apercu suit le store. Le lecteur replanifie l'audio lui-meme si
  // la lecture est en cours.
  useEffect(() => {
    playerRef.current?.setRate(rate);
  }, [rate]);

  // --- Transport piloté par l'etat.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    if (isPlaying && !player.isPlaying) void player.play();
    else if (!isPlaying && player.isPlaying) player.pause();
  }, [isPlaying]);

  // --- Deplacement de la tete de lecture depuis la timeline.
  useEffect(() => {
    // On s'abonne hors de React: pendant un scrub, le temps change a chaque
    // frame et un re-rendu par frame ferait chuter la fluidite.
    return usePlaybackStore.subscribe((state, previous) => {
      if (state.time === previous.time) return;
      const player = playerRef.current;
      // Pendant la lecture, c'est le lecteur qui EMET le temps: le lui renvoyer
      // provoquerait une boucle de seeks.
      if (!player || player.isPlaying) return;
      player.seek(state.time);
    });
  }, []);

  const togglePlay = () => {
    // Un geste de recadrage se termine par un clic: sans ce garde-fou, chaque
    // repositionnement lancerait la lecture.
    if (crop.hasMoved()) return;
    if (!hasClips) return;
    setPlaying(!isPlaying);
  };

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
      <canvas
        // Deux refs sur le meme noeud: celle du lecteur, et celle du geste de
        // recadrage qui a besoin de mesurer la surface.
        ref={(node) => {
          canvasRef.current = node;
          crop.attachSurface(node);
        }}
        {...crop.bind()}
        onClick={togglePlay}
        aria-label={t('preview.label')}
        // `touch-none`: sans lui, le navigateur intercepte le glissement pour
        // son propre defilement et le recadrage devient erratique.
        className="h-full max-h-full w-auto max-w-full touch-none object-contain"
        style={{ aspectRatio: `${project.frame.width} / ${project.frame.height}` }}
      />

      {/*
        Les reperes se superposent au canvas et doivent donc partager sa boite
        exacte. Le canvas etant en `object-contain` avec un `aspectRatio` impose,
        c'est le conteneur centre ci-dessous qui reproduit cette boite — s'aligner
        sur `inset-0` du parent decalerait les reperes des que la mise en page
        laisse des marges.
      */}
      {framing && (
        <div
          className="pointer-events-none absolute flex h-full max-h-full w-auto max-w-full"
          style={{ aspectRatio: `${project.frame.width} / ${project.frame.height}` }}
        >
          <FramingGuides framing={framing} />
        </div>
      )}

      {/*
        Zoom du plan: en bas a GAUCHE, face aux commandes d'affichage (compact,
        plein ecran) posees a droite. Deux familles distinctes, deux coins: ces
        boutons-ci modifient le montage, ceux d'en face ne changent que la vue.

        Masque pendant la lecture, comme les reperes: on ne cadre pas une image
        qui defile, et la pastille de lecture occupe deja le centre.
      */}
      {hasClips && !isPlaying && !fullscreen && <PreviewZoom />}

      {!hasClips && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
          <p className="text-center text-sm text-ink-400">{t('preview.empty')}</p>
        </div>
      )}

      {/* Bouton plein ecran: pose sur l'image, en bas a droite, la ou il ne
          recouvre ni la pastille de lecture ni le haut du cadre 9:16. En plein
          ecran il disparait — la sortie se fait par la croix de la coquille. */}
      {!fullscreen && (
        <div className="absolute bottom-2 right-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            aria-label={t('preview.fullscreen')}
            // Icone nue et ombre portee, comme les commandes de lecture: la
            // pastille alourdissait l'apercu sans rien apporter a la lisibilite.
            className="flex size-11 items-center justify-center text-ink-50 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] transition-opacity active:opacity-70 [&>svg]:size-5"
          >
            <ExpandIcon />
          </button>
        </div>
      )}

      {/*
        Plus de pastille de lecture au centre.

        Elle datait d'avant les commandes flottantes: il n'y avait alors aucun
        bouton de lecture SUR l'image. Depuis, `PreviewControls` en pose un juste
        en dessous — deux symboles « play » a l'ecran, dont un seul reagit au
        toucher, laissaient croire que l'image entiere etait cliquable.
      */}
    </div>
  );
}
