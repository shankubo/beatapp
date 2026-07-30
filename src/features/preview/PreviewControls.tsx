/**
 * Commandes de lecture, en surimpression sur l'apercu.
 *
 * Remplace la barre de transport, qui occupait 44 px de hauteur en permanence
 * pour trois boutons. L'apercu 9:16 etant contraint par la HAUTEUR, c'etait
 * l'axe le plus cher a payer.
 *
 * Comportement Instagram: les BOUTONS s'effacent apres deux secondes de lecture
 * et reviennent au moindre contact. En pause ils restent — on est alors en
 * train de chercher un bouton, pas de regarder.
 *
 * Le compteur de temps, lui, ne s'efface jamais: c'est pendant la lecture qu'on
 * veut savoir ou l'on en est. Les deux groupes portent donc leur propre
 * transition, plutot qu'un fondu pose sur le conteneur commun.
 *
 * Icones NUES, detourees par une ombre portee. Les pastilles sombres posees au
 * depart garantissaient le contraste mais decoupaient l'apercu en vignettes;
 * `drop-shadow` detoure le glyphe sur n'importe quel fond, y compris un ciel
 * blanc, sans ajouter de surface opaque.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSyncExternalStore } from 'react';

import {
  PauseIcon,
  PlayIcon,
  RedoIcon,
  SkipBackIcon,
  SkipForwardIcon,
  UndoIcon,
} from '../../components/ui/icons';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { useProjectStore } from '../../store/useProjectStore';
import { clipIndexAt, videoDuration } from '../../domain/timeline';
import { formatTimecode } from '../../lib/format';

/** Delai avant effacement pendant la lecture, en millisecondes. */
const HIDE_MS = 2000;

export function PreviewControls() {
  const { t, i18n } = useTranslation(['editor', 'common']);

  const project = useProjectStore((state) => state.project);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const setPlaying = usePlaybackStore((state) => state.setPlaying);
  const setTime = usePlaybackStore((state) => state.setTime);

  const duration = videoDuration(project.videoTrack);
  const hasClips = project.videoTrack.clips.length > 0;

  const history = useProjectStore.temporal;
  const historyState = useSyncExternalStore(
    (listener) => history.subscribe(listener),
    () => history.getState(),
  );

  /*
    Visibilite des commandes.

    Etat DERIVE et non synchronise: on ne stocke que l'instant du dernier
    reveil, et l'effet se contente d'armer un minuteur qui le compare. Ecrire
    `setVisible(true)` dans un effet declenchait des rendus en cascade — la
    regle `react-hooks/set-state-in-effect` l'attrape, et elle a raison: avec
    `visible` en dependance, chaque reveil re-armait le minuteur en boucle.

    Une seule regle metier: on cache UNIQUEMENT pendant la lecture. A l'arret
    tout reste affiche — masquer des boutons sur une image figee donnerait une
    interface qui semble avoir disparu.
  */
  const [hidden, setHidden] = useState(false);
  const [wokeAt, setWokeAt] = useState(() => Date.now());

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setTimeout(() => setHidden(true), HIDE_MS);
    return () => window.clearTimeout(timer);
    // `wokeAt` re-arme le minuteur a chaque contact, sans lire `hidden`.
  }, [isPlaying, wokeAt]);

  const visible = !hidden || !isPlaying;

  /** Tout contact sur l'apercu ramene les commandes. */
  const reveal = () => {
    setHidden(false);
    setWokeAt(Date.now());
  };

  const jumpToClipBoundary = (direction: -1 | 1) => {
    const time = usePlaybackStore.getState().time;
    const clips = project.videoTrack.clips;
    const index = clipIndexAt(project.videoTrack, time);
    if (index < 0) return;

    const current = clips[index]!;
    if (direction === -1) {
      // Retour au debut du clip courant, sauf si on y est deja (a une frame
      // pres): dans ce cas on remonte au clip precedent.
      const atStart = time - current.start < 1 / project.frame.fps;
      const target = atStart ? clips[index - 1] : current;
      setTime(target ? target.start : 0);
    } else {
      const next = clips[index + 1];
      setTime(next ? next.start : duration);
    }
  };

  return (
    <div
      // Capte le contact pour reveler, sans bloquer les gestes de l'apercu.
      onPointerDown={reveal}
      className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end"
    >
      {/*
        TOUT en bas, sur deux rangees.

        Piege mesure: annuler/retablir etaient d'abord poses en haut a gauche —
        exactement ou vivent le bouton de menu et le nom du projet, tous deux
        flottants eux aussi. Les rectangles se chevauchaient (Menu/Annuler et
        Nom/Retablir), et un cercle vide venait couper le titre. Rien ne les
        separait: en surimpression, deux groupes qui visent le meme coin se
        recouvrent en silence.

        Le bas est libre, et c'est de toute facon la zone du pouce.
      */}
      <div
        className={[
          'pointer-events-auto flex items-center gap-1 p-2',
          'transition-opacity duration-300',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
      >
        <GlassButton
          label={t('common:action.undo')}
          onClick={() => history.getState().undo()}
          disabled={historyState.pastStates.length === 0}
        >
          <UndoIcon />
        </GlassButton>
        <GlassButton
          label={t('common:action.redo')}
          onClick={() => history.getState().redo()}
          disabled={historyState.futureStates.length === 0}
        >
          <RedoIcon />
        </GlassButton>
      </div>

      {/*
        Compteur CENTRE, juste au-dessus des boutons de lecture.

        Il etait auparavant colle a droite, ou il se retrouvait isole du groupe
        qu'il decrit — et masque par le rail d'outils. Au centre, il se lit dans
        le meme mouvement du regard que la lecture.

        Il ne s'efface PAS avec les boutons: c'est justement pendant la lecture
        qu'on veut savoir ou l'on en est. Les boutons, eux, se retirent parce
        qu'ils masquent l'image sans rien apprendre.
      */}
      <div className="pointer-events-none flex justify-center pb-0.5">
        <Timecode duration={duration} locale={i18n.language} />
      </div>

      {/*
        Lecture centree sur l'ECRAN, pas sur l'espace restant.

        Piege mesure: un `pr-14` reservait la largeur du rail d'outils, ce qui
        decalait tout le groupe vers la gauche — visible a l'oeil des qu'on
        cherchait le bouton sous le pouce. Le rail est en surimpression a droite
        et ne recouvre AUCUN de ces trois boutons a 393 px: rien n'a donc a lui
        etre reserve, et le centrage redevient celui de l'ecran.
      */}
      <div
        className={[
          'pointer-events-auto flex items-center justify-center gap-2 p-2',
          'transition-opacity duration-300',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
      >
        <GlassButton
          label={t('editor:transport.previousClip')}
          onClick={() => jumpToClipBoundary(-1)}
          disabled={!hasClips}
        >
          <SkipBackIcon />
        </GlassButton>

        <button
          type="button"
          onClick={() => setPlaying(!isPlaying)}
          disabled={!hasClips}
          aria-label={isPlaying ? t('editor:transport.pause') : t('editor:transport.play')}
          /*
            Cible de 44 px conservee, ICONE reduite a 28 px.

            La regle des 44 px du projet porte sur la zone TOUCHABLE, pas sur ce
            qu'on voit: on peut donc alleger le dessin sans rendre le bouton
            plus difficile a viser. L'ombre portee remplace la pastille — sur
            une image claire, une icone sans fond ni ombre tombe sous le seuil
            de contraste de 4,5:1.
          */
          className="flex size-11 items-center justify-center text-beat-400 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] transition-opacity active:opacity-70 disabled:opacity-40 [&>svg]:size-7"
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <GlassButton
          label={t('editor:transport.nextClip')}
          onClick={() => jumpToClipBoundary(1)}
          disabled={!hasClips}
        >
          <SkipForwardIcon />
        </GlassButton>
      </div>
    </div>
  );
}

/**
 * Bouton nu: l'icone seule, sans pastille ni bordure.
 *
 * La lisibilite ne vient plus d'un fond mais d'une OMBRE PORTEE. Sur une image
 * claire, une icone `ink-100` posee sans rien passerait sous le seuil de
 * contraste de 4,5:1 que le projet s'impose; l'ombre la detoure quel que soit
 * le fond, sans ajouter le disque qui alourdissait l'apercu.
 *
 * La cible reste a 44 px: c'est la zone touchable, invisible ici, et la reduire
 * rendrait les commandes penibles a viser au pouce.
 */
function GlassButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex size-11 items-center justify-center text-ink-50 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] transition-opacity active:opacity-70 disabled:opacity-40 [&>svg]:size-5"
    >
      {children}
    </button>
  );
}

/**
 * Compteur de temps.
 *
 * Abonnement direct au store plutot que `useStore`: le temps change 60 fois par
 * seconde en lecture, et re-rendre l'arbre parent a cette cadence couterait
 * bien plus cher que ce seul noeud de texte.
 */
function Timecode({ duration, locale }: { duration: number; locale: string }) {
  const time = useSyncExternalStore(
    (listener) => usePlaybackStore.subscribe(listener),
    () => usePlaybackStore.getState().time,
  );

  return (
    <div className="tnum px-1 text-[11px] leading-tight text-ink-100 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
      {formatTimecode(time, locale)} / {formatTimecode(duration, locale)}
    </div>
  );
}
