/**
 * Ecoute d'une boucle generee, sans l'ajouter au projet.
 *
 * Le besoin: choisir une boucle demandait jusqu'ici de l'APPLIQUER pour
 * l'entendre, donc d'ecraser la musique en place, puis de recommencer pour la
 * suivante. On ecoute maintenant avant de choisir.
 *
 * La lecture passe par un `AudioBufferSourceNode` jetable et ne touche NI au
 * projet, NI au `Player`: une ecoute n'est pas une lecture du montage, et les
 * melanger ferait entrer une audition dans l'historique d'annulation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { findGeneratedSample, renderSample } from './sampleGen';
import { useMedia } from '../preview/MediaProvider';

/**
 * Duree d'ecoute, en secondes.
 *
 * Deux mesures a 120 BPM font 4 s: assez pour reconnaitre un motif, assez court
 * pour enchainer les essais sans attendre. Au-dela, on ecoute une repetition
 * qui n'apprend plus rien.
 */
const PREVIEW_SECONDS = 6;

export function useSamplePreview(): {
  /** Identifiant de la boucle en cours d'ecoute, ou `null`. */
  playingId: string | null;
  /** Lance l'ecoute, ou l'arrete si c'est deja cette boucle qui joue. */
  toggle: (sampleId: string) => void;
  stop: () => void;
} {
  const { audioContext } = useMedia();
  const [playingId, setPlayingId] = useState<string | null>(null);

  /*
    La source vit dans une ref et non dans l'etat: elle change a chaque ecoute
    mais ne doit rien re-rendre, et surtout `stop` doit pouvoir l'atteindre
    depuis une closure creee a n'importe quel rendu.
  */
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stop = useCallback(() => {
    const source = sourceRef.current;
    if (!source) return;
    sourceRef.current = null;
    /*
      `onended` est detache AVANT l'arret: sans cela, le rappel se declenche et
      remet `playingId` a null alors qu'une nouvelle ecoute vient peut-etre de
      demarrer — le bouton s'eteindrait aussitot allume.
    */
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Deja arretee: `stop()` sur une source terminee leve, sans consequence.
    }
    source.disconnect();
    setPlayingId(null);
  }, []);

  const toggle = useCallback(
    (sampleId: string) => {
      // Retaper la boucle en cours l'arrete: comportement attendu d'un bouton
      // qui affiche « arreter » pendant la lecture.
      if (sourceRef.current && playingId === sampleId) {
        stop();
        return;
      }
      stop();

      const sample = findGeneratedSample(sampleId);
      if (!sample) return;

      /*
        `resume()` est indispensable ici.

        L'`AudioContext` est cree hors geste utilisateur, donc `suspended`: sans
        cet appel, la source jouerait dans le vide et le bouton s'allumerait
        sans qu'aucun son ne sorte. La regle vaut pour tout gestionnaire de clic
        menant a du son.
      */
      void audioContext.resume();

      const buffer = renderSample(sample, audioContext, PREVIEW_SECONDS);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);

      source.onended = () => {
        // Garde-fou: une source plus recente peut avoir pris la place entre
        // temps, et eteindre son bouton serait faux.
        if (sourceRef.current !== source) return;
        sourceRef.current = null;
        setPlayingId(null);
      };

      sourceRef.current = source;
      // Borne la duree: `renderSample` repete la boucle pour atteindre le
      // minimum demande et peut donc depasser largement.
      source.start(0, 0, Math.min(PREVIEW_SECONDS, buffer.duration));
      setPlayingId(sampleId);
    },
    [audioContext, playingId, stop],
  );

  // Fermer le panneau doit couper le son: une boucle qui continue alors que son
  // bouton a disparu ne peut plus etre arretee.
  useEffect(() => stop, [stop]);

  return { playingId, toggle, stop };
}
