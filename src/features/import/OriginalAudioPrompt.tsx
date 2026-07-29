/**
 * Demande si le son d'origine d'une video doit servir au reel.
 *
 * Pourquoi DEMANDER plutot que decider. Les deux reponses sont legitimes et
 * frequentes: on importe une video pour son image seule (le son sera la musique)
 * ou pour ce qu'on y entend (une voix, une ambiance). Choisir a la place de
 * l'utilisateur produirait un reel muet la ou il attendait une voix, ou une
 * cacophonie par-dessus la musique.
 *
 * La question n'est posee QUE si le conteneur porte reellement une piste sonore,
 * sondee a l'import. Une video muette n'ouvre aucun dialogue.
 *
 * Refuser n'est pas destructif: le son reste dans le fichier importe et
 * l'onglet Audio permet de l'ajouter plus tard.
 */

import { useTranslation } from 'react-i18next';

import { MusicIcon } from '../../components/ui/icons';
import type { MediaAsset } from '../../domain/types';

interface OriginalAudioPromptProps {
  /** Videos sonores en attente de decision. */
  assets: readonly MediaAsset[];
  onAccept: () => void;
  onDecline: () => void;
}

export function OriginalAudioPrompt({
  assets,
  onAccept,
  onDecline,
}: OriginalAudioPromptProps) {
  const { t } = useTranslation(['editor', 'common']);

  if (assets.length === 0) return null;

  return (
    // `z-50`: au-dessus du panneau et de la barre d'onglets, comme les autres
    // dialogues de l'application.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 pb-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('editor:originalAudio.title')}
        className="w-full max-w-sm rounded-2xl border border-ink-600 bg-ink-900 p-4"
      >
        <span className="flex size-10 items-center justify-center rounded-xl bg-audio-400/15 text-audio-400 [&>svg]:size-5">
          <MusicIcon />
        </span>

        <h2 className="mt-3 text-base font-semibold tracking-tight text-ink-50">
          {t('editor:originalAudio.title')}
        </h2>

        <p className="mt-1.5 text-sm leading-relaxed text-ink-300">
          {t('editor:originalAudio.body', { count: assets.length })}
        </p>

        <p className="mt-2 text-xs leading-relaxed text-ink-400">
          {t('editor:originalAudio.hint')}
        </p>

        {/* La reponse positive en premier et en couleur: c'est le choix le plus
            courant quand on a pris la peine d'importer une video parlante. */}
        <button
          type="button"
          onClick={onAccept}
          className="mt-4 min-h-12 w-full rounded-xl bg-audio-400 text-sm font-semibold text-ink-950 active:opacity-90"
        >
          {t('editor:originalAudio.keep')}
        </button>

        <button
          type="button"
          onClick={onDecline}
          className="mt-2 min-h-12 w-full rounded-xl border border-ink-600 text-sm font-medium text-ink-200 active:bg-ink-800"
        >
          {t('editor:originalAudio.discard')}
        </button>
      </div>
    </div>
  );
}
