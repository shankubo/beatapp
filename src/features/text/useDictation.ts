/**
 * Dictee des paroles au micro, horodatee.
 *
 * L'interet n'est pas la transcription en soi — Gemini fait mieux — mais le
 * CALAGE: chaque phrase est datee a l'instant ou elle a ete prononcee, pendant
 * que la musique joue. Les lignes sortent donc deja synchronisees, sans grille
 * rythmique ni ajustement manuel.
 *
 * `SpeechRecognition` n'est disponible que sur Chrome / Edge, et chez eux l'audio
 * du micro transite par un service de Google. Ce n'est pas contournable et doit
 * etre annonce dans l'interface avant tout enregistrement.
 *
 * L'horloge est celle du lecteur (`AudioContext`), jamais `performance.now()`:
 * c'est la meme regle que partout ailleurs dans le projet, et c'est ce qui fait
 * tomber les lignes au bon endroit du montage.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Seconds } from '../../domain/types';

export interface DictatedLine {
  text: string;
  /** Instant du montage, en secondes. */
  start: Seconds;
}

/**
 * Constructeur de reconnaissance vocale, prefixe sur Chrome.
 *
 * Typage local: `SpeechRecognition` n'est pas dans les types DOM standards, et
 * declarer l'interface complete serait disproportionne pour les trois membres
 * reellement utilises.
 */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechResultEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: { isFinal: boolean; 0: { transcript: string } };
  };
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognition(): SpeechRecognitionConstructor | null {
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** La dictee est-elle disponible ? A appeler avant d'afficher le bouton. */
export function isDictationSupported(): boolean {
  return speechRecognition() !== null;
}

export function useDictation(options: {
  /** Langue de dictee, au format BCP 47. */
  lang: string;
  /** Position courante du montage, lue a chaque phrase reconnue. */
  currentTime: () => Seconds;
  onError: (key: 'errors:speech.unsupported' | 'errors:speech.denied' | 'errors:speech.failed') => void;
}): {
  listening: boolean;
  lines: readonly DictatedLine[];
  interim: string;
  start: () => void;
  stop: () => void;
  reset: () => void;
} {
  const { lang, currentTime, onError } = options;

  const [listening, setListening] = useState(false);
  const [lines, setLines] = useState<DictatedLine[]>([]);
  const [interim, setInterim] = useState('');

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  /**
   * Les rappels sont lus depuis une ref.
   *
   * `SpeechRecognition` est un objet externe cree une seule fois: les fonctions
   * qu'on lui attache captureraient sinon la premiere valeur de `currentTime`,
   * et toutes les lignes tomberaient au meme instant.
   */
  const handlers = useRef({ currentTime, onError });
  useEffect(() => {
    handlers.current = { currentTime, onError };
  }, [currentTime, onError]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
    setInterim('');
  }, []);

  const start = useCallback(() => {
    const Recognition = speechRecognition();
    if (!Recognition) {
      handlers.current.onError('errors:speech.unsupported');
      return;
    }

    const recognition = new Recognition();
    recognition.lang = lang;
    // `continuous`: on dicte plusieurs phrases d'affilee sans relancer.
    recognition.continuous = true;
    // Les resultats provisoires alimentent l'affichage en direct, ce qui rend
    // l'enregistrement lisible plutot qu'aveugle.
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let pending = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]!;
        const text = result[0].transcript.trim();
        if (text.length === 0) continue;

        if (result.isFinal) {
          // L'instant est lu MAINTENANT: c'est tout l'interet de la dictee.
          setLines((previous) => [...previous, { text, start: handlers.current.currentTime() }]);
        } else {
          pending = text;
        }
      }

      setInterim(pending);
    };

    recognition.onerror = (event) => {
      // « aborted » est le resultat normal d'un arret demande: pas une erreur.
      if (event.error === 'aborted') return;
      handlers.current.onError(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'errors:speech.denied'
          : 'errors:speech.failed',
      );
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      setInterim('');
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [lang]);

  const reset = useCallback(() => {
    setLines([]);
    setInterim('');
  }, []);

  // Le micro ne doit jamais survivre au demontage du panneau.
  useEffect(() => {
    return () => recognitionRef.current?.abort();
  }, []);

  return { listening, lines, interim, start, stop, reset };
}
