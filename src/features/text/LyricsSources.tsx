/**
 * Les trois voies d'entree des paroles.
 *
 * Elles convergent toutes vers le meme rendu et le meme calage — seule l'origine
 * du texte change:
 *
 * 1. **Fichier `.lrc` / `.srt`**: le calage EXISTE deja dans le fichier, on le
 *    respecte (`setLyricsLines`). C'est la source la plus fiable.
 * 2. **Dictee au micro**: chaque phrase est datee a l'instant prononce, donc
 *    calee par construction. Chrome / Edge seulement.
 * 3. **Transcription IA**: Gemini rend du texte nu, qui repart ensuite dans le
 *    calage sur les beats (`setLyricsFromText`). Grok ne transcrit pas d'audio et
 *    ne sert donc qu'a la mise en forme.
 *
 * Les deux dernieres voies envoient des donnees vers l'exterieur. C'est annonce
 * AVANT l'action, pas apres, parce que c'est la seule sortie de l'application.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectStore } from '../../store/useProjectStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { useUiStore } from '../../store/useUiStore';
import { useMedia } from '../preview/MediaProvider';
import { musicTrack } from '../../domain/project';
import { videoDuration } from '../../domain/timeline';
import { fitLinesToReel, parseLyricsFile } from '../../domain/lyricsFile';
import {
  AiError,
  formatLyrics,
  transcribeAudio,
  type AiErrorKey,
  type AiProvider,
} from './aiLyrics';
import type { LyricLine } from '../../domain/types';
import { isDictationSupported, useDictation } from './useDictation';
import { readAiKey, writeAiKey } from '../../storage/aiKeyStore';
import { Segmented } from '../../components/ui/Segmented';
import { MusicIcon, SparkIcon } from '../../components/ui/icons';
import { formatDuration } from '../../lib/format';

/** Onglet d'entree actif. `null` = rien de deplie. */
type Source = 'file' | 'dictate' | 'ai';

export function LyricsSources() {
  const { t, i18n } = useTranslation(['editor', 'errors', 'common']);

  const project = useProjectStore((state) => state.project);
  const setLyricsLines = useProjectStore((state) => state.setLyricsLines);
  const setLyricsFromText = useProjectStore((state) => state.setLyricsFromText);
  const pushToast = useUiStore((state) => state.pushToast);
  const { blobs } = useMedia();

  const [source, setSource] = useState<Source | null>(null);

  const track = musicTrack(project);
  const audioBlob = track ? blobs.get(track.assetId) : undefined;
  const reelDuration = videoDuration(project.videoTrack);

  return (
    <div className="space-y-2">
      {/* Trois entrees repliees: le chemin principal reste « coller », juste en
          dessous, et ces voies ne s'ouvrent que si on les demande. */}
      <div className="grid grid-cols-3 gap-1.5">
        <SourceTab
          label={t('editor:lyrics.fromFile')}
          active={source === 'file'}
          onClick={() => setSource(source === 'file' ? null : 'file')}
        />
        <SourceTab
          label={t('editor:lyrics.fromMic')}
          active={source === 'dictate'}
          onClick={() => setSource(source === 'dictate' ? null : 'dictate')}
        />
        <SourceTab
          label={t('editor:lyrics.fromAi')}
          active={source === 'ai'}
          onClick={() => setSource(source === 'ai' ? null : 'ai')}
        />
      </div>

      {source === 'file' && (
        <FileSource
          reelDuration={reelDuration}
          onLines={setLyricsLines}
          onError={(key) => pushToast({ i18nKey: key, tone: 'error' })}
        />
      )}

      {source === 'dictate' && (
        <DictateSource
          lang={i18n.language}
          onLines={setLyricsLines}
          onError={(key) => pushToast({ i18nKey: key, tone: 'error' })}
        />
      )}

      {source === 'ai' && (
        <AiSource
          audioBlob={audioBlob}
          audioDuration={track?.source.out}
          onText={setLyricsFromText}
          onLines={setLyricsLines}
          onError={(key) => pushToast({ i18nKey: key, tone: 'error' })}
        />
      )}
    </div>
  );
}

function SourceTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'min-h-11 rounded-lg border px-1 text-[11px] font-medium',
        active
          ? 'border-beat-400 text-beat-400'
          : 'border-ink-600 text-ink-200 active:bg-ink-800',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 1. Fichier .lrc / .srt
// ---------------------------------------------------------------------------

function FileSource({
  reelDuration,
  onLines,
  onError,
}: {
  reelDuration: number;
  onLines: (lines: readonly LyricLine[]) => void;
  onError: (key: 'errors:lyricsFile.unreadable' | 'errors:lyricsFile.empty') => void;
}) {
  const { t, i18n } = useTranslation(['editor', 'common']);
  const input = useRef<HTMLInputElement>(null);

  /** Instant de la CHANSON qui correspond au debut du reel. */
  const [from, setFrom] = useState(0);
  const [pending, setPending] = useState<{
    lines: readonly LyricLine[];
    format: string;
  } | null>(null);

  const handleFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    // Un fichier de paroles est du texte: pas de validation par magic bytes ici,
    // mais le format est reconnu par son CONTENU et non par son extension.
    const raw = await file.text();
    const parsed = parseLyricsFile(raw);
    if (!parsed) {
      onError('errors:lyricsFile.unreadable');
      return;
    }
    setPending({ lines: parsed.lines, format: parsed.format });
  };

  const apply = () => {
    if (!pending) return;
    const fitted = fitLinesToReel(pending.lines, { from, until: reelDuration });
    if (fitted.length === 0) {
      // Le decalage place tout hors du montage: on le dit plutot que de vider
      // silencieusement les paroles.
      onError('errors:lyricsFile.empty');
      return;
    }
    onLines(fitted);
    setPending(null);
  };

  return (
    <div className="space-y-2 rounded-xl border border-ink-600 bg-ink-850 p-3">
      <p className="text-xs leading-relaxed text-ink-400">{t('editor:lyrics.fileHint')}</p>

      <button
        type="button"
        onClick={() => input.current?.click()}
        className="min-h-11 w-full surface rounded-xl border border-ink-600 bg-ink-800 text-sm font-medium text-ink-50 active:bg-ink-700"
      >
        {t('editor:lyrics.chooseFile')}
      </button>

      <input
        ref={input}
        type="file"
        // Indication pour le selecteur; le format reel est detecte au contenu.
        accept=".lrc,.srt,.txt,text/plain"
        className="hidden"
        onChange={(event) => {
          void handleFile(event.target.files);
          event.target.value = '';
        }}
      />

      {pending && (
        <div className="space-y-2 border-t border-ink-700 pt-2">
          <p className="text-xs text-ink-300">
            {t('editor:lyrics.fileLoaded', {
              count: pending.lines.length,
              format: pending.format.toUpperCase(),
            })}
          </p>

          {/* Un fichier couvre la chanson entiere, un reel quelques secondes:
              sans ce decalage, presque toutes les lignes tomberaient dehors. */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-400">
              {t('editor:lyrics.songOffset')}
            </span>
            <input
              type="number"
              value={from}
              min={0}
              step={0.5}
              onChange={(event) => setFrom(Math.max(0, Number(event.target.value) || 0))}
              className="tnum min-h-11 w-full rounded-lg border border-ink-600 bg-ink-900 px-2 text-sm text-ink-50 outline-none focus:border-beat-400"
            />
          </label>
          <p className="text-[11px] text-ink-400">
            {t('editor:lyrics.songOffsetHint', {
              duration: formatDuration(reelDuration, i18n.language),
            })}
          </p>

          <button
            type="button"
            onClick={apply}
            className="min-h-11 w-full rounded-xl bg-beat-400 text-sm font-semibold text-ink-950 active:bg-beat-500"
          >
            {t('editor:lyrics.useFile')}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Dictee au micro
// ---------------------------------------------------------------------------

function DictateSource({
  lang,
  onLines,
  onError,
}: {
  lang: string;
  onLines: (lines: readonly LyricLine[]) => void;
  onError: (
    key: 'errors:speech.unsupported' | 'errors:speech.denied' | 'errors:speech.failed',
  ) => void;
}) {
  // `errors` est charge ici: le message d'indisponibilite est rendu directement
  // dans ce composant, pas remonte par un toast.
  const { t, i18n } = useTranslation(['editor', 'errors', 'common']);
  const supported = isDictationSupported();

  const dictation = useDictation({
    lang,
    // L'instant est lu au moment ou la phrase est reconnue: c'est ce qui cale
    // les lignes. On passe une fonction, jamais une valeur capturee.
    currentTime: () => usePlaybackStore.getState().time,
    onError,
  });

  if (!supported) {
    return (
      <p className="rounded-xl border border-ink-600 bg-ink-850 p-3 text-xs leading-relaxed text-ink-400">
        {t('errors:speech.unsupported')}
      </p>
    );
  }

  const apply = () => {
    // Chaque phrase court jusqu'a la suivante: le calage vient des instants
    // reels de la dictee, il n'y a rien a recalculer.
    const lines = dictation.lines.map((line, index) => {
      const next = dictation.lines[index + 1];
      return {
        id: `lyric_dict_${index}`,
        text: line.text,
        start: line.start,
        duration: Math.max(0.3, (next ? next.start : line.start + 2.5) - line.start),
      };
    });
    onLines(lines);
    dictation.reset();
  };

  return (
    <div className="space-y-2 rounded-xl border border-ink-600 bg-ink-850 p-3">
      {/* La sortie de donnees est annoncee AVANT l'enregistrement. */}
      <p className="text-xs leading-relaxed text-ink-400">{t('editor:lyrics.micHint')}</p>

      <button
        type="button"
        onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
        className={[
          'flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold',
          dictation.listening
            ? 'bg-danger-500 text-ink-50'
            : 'bg-beat-400 text-ink-950 active:bg-beat-500',
        ].join(' ')}
      >
        {dictation.listening ? t('editor:lyrics.micStop') : t('editor:lyrics.micStart')}
      </button>

      {(dictation.lines.length > 0 || dictation.interim.length > 0) && (
        <ul className="space-y-1 border-t border-ink-700 pt-2">
          {dictation.lines.map((line, index) => (
            <li key={index} className="flex gap-2 text-xs">
              <span className="tnum shrink-0 text-ink-400">
                {formatDuration(line.start, i18n.language)}
              </span>
              <span className="min-w-0 flex-1 text-ink-200">{line.text}</span>
            </li>
          ))}
          {dictation.interim.length > 0 && (
            // Le provisoire est grise: on voit que la phrase n'est pas figee.
            <li className="text-xs text-ink-500">{dictation.interim}</li>
          )}
        </ul>
      )}

      {dictation.lines.length > 0 && !dictation.listening && (
        <button
          type="button"
          onClick={apply}
          className="min-h-11 w-full surface rounded-xl border border-ink-600 bg-ink-800 text-sm font-medium text-ink-50 active:bg-ink-700"
        >
          {t('editor:lyrics.useDictation', { count: dictation.lines.length })}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Transcription / mise en forme par IA
// ---------------------------------------------------------------------------

function AiSource({
  audioBlob,
  audioDuration,
  onText,
  onLines,
  onError,
}: {
  audioBlob: Blob | undefined;
  audioDuration: number | undefined;
  onText: (raw: string) => void;
  onLines: (lines: readonly LyricLine[]) => void;
  onError: (key: AiErrorKey) => void;
}) {
  const { t } = useTranslation(['editor', 'errors', 'common']);

  // Groq par defaut: c'est le seul des deux qui rende des horodatages.
  const [provider, setProvider] = useState<AiProvider>('groq');
  const [key, setKey] = useState(() => readAiKey('groq'));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  /**
   * Lignes datees renvoyees par Whisper, s'il y en a.
   *
   * Conservees a part du texte: si l'utilisateur redecoupe ou modifie le texte,
   * ces lignes ne lui correspondent plus et doivent etre abandonnees.
   */
  const [timed, setTimed] = useState<readonly LyricLine[] | null>(null);

  const changeProvider = (next: AiProvider) => {
    setProvider(next);
    // Chaque fournisseur a sa propre cle: on recharge celle du nouveau.
    setKey(readAiKey(next));
  };

  const saveKey = (value: string) => {
    setKey(value);
    writeAiKey(provider, value);
  };

  const transcribe = async () => {
    if (!audioBlob) return;
    setBusy(true);
    try {
      const transcription = await transcribeAudio(audioBlob, {
        provider,
        apiKey: key,
        duration: audioDuration,
      });
      setResult(transcription.text);
      setTimed(transcription.lines ?? null);
    } catch (error) {
      onError(error instanceof AiError ? error.i18nKey : 'errors:ai.requestFailed');
    } finally {
      setBusy(false);
    }
  };

  const reformat = async () => {
    setBusy(true);
    try {
      const text = await formatLyrics(result, { provider, apiKey: key });
      setResult(text);
      // Le redecoupage casse la correspondance avec les segments: les
      // horodatages ne valent plus rien, on repassera par les beats.
      setTimed(null);
    } catch (error) {
      onError(error instanceof AiError ? error.i18nKey : 'errors:ai.requestFailed');
    } finally {
      setBusy(false);
    }
  };

  /** Le texte a-t-il ete modifie depuis la transcription datee ? */
  const editedAway =
    timed !== null && result.trim() !== timed.map((line) => line.text).join('\n').trim();

  // Les deux moteurs transcrivent; il faut seulement une piste audio.
  const canTranscribe = audioBlob !== undefined;

  return (
    <div className="space-y-2 rounded-xl border border-ink-600 bg-ink-850 p-3">
      {/* L'envoi vers un service tiers est annonce avant toute action. */}
      <p className="rounded-lg border border-danger-500/40 bg-danger-500/10 p-2 text-xs leading-relaxed text-ink-200">
        {t('editor:lyrics.aiWarning')}
      </p>

      <Segmented
        label={t('editor:lyrics.aiProvider')}
        options={[
          { value: 'groq', label: t('editor:lyrics.providerGroq') },
          { value: 'gemini', label: t('editor:lyrics.providerGemini') },
        ]}
        value={provider}
        onChange={changeProvider}
      />

      <p className="text-[11px] leading-relaxed text-ink-400">
        {provider === 'groq'
          ? t('editor:lyrics.groqRole')
          : t('editor:lyrics.geminiRole')}
      </p>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-400">
          {t('editor:lyrics.apiKey')}
        </span>
        <input
          type="password"
          value={key}
          onChange={(event) => saveKey(event.target.value)}
          // `autoComplete="off"`: une cle API n'a rien a faire dans le
          // gestionnaire de mots de passe du navigateur.
          autoComplete="off"
          spellCheck={false}
          className="min-h-11 w-full rounded-lg border border-ink-600 bg-ink-900 px-2 text-sm text-ink-50 outline-none focus:border-beat-400"
        />
      </label>
      <p className="text-[11px] leading-relaxed text-ink-400">
        {t('editor:lyrics.apiKeyHint')}
      </p>

      {canTranscribe && (
        <button
          type="button"
          onClick={() => void transcribe()}
          disabled={busy || key.trim().length === 0}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-beat-400 text-sm font-semibold text-ink-950 active:bg-beat-500 disabled:opacity-60 [&>svg]:size-4"
        >
          <SparkIcon />
          {busy ? t('common:state.analyzing') : t('editor:lyrics.transcribe')}
        </button>
      )}

      {audioBlob === undefined && (
        <p className="flex items-center gap-2 text-xs text-ink-400 [&>svg]:size-4">
          <MusicIcon />
          {t('editor:lyrics.needMusic')}
        </p>
      )}

      {result.length > 0 && (
        <div className="space-y-2 border-t border-ink-700 pt-2">
          <textarea
            value={result}
            onChange={(event) => setResult(event.target.value)}
            rows={5}
            aria-label={t('editor:lyrics.aiResult')}
            className="w-full resize-none rounded-lg border border-ink-600 bg-ink-900 p-2 text-sm text-ink-50 outline-none focus:border-beat-400"
          />

          {/* Whisper a date ses segments: on le dit, parce que cela change ce
              que fera le bouton d'application. */}
          {timed !== null && !editedAway && (
            <p className="rounded-lg border border-beat-400/35 bg-beat-400/10 p-2 text-[11px] leading-relaxed text-ink-200">
              {t('editor:lyrics.timedNote', { count: timed.length })}
            </p>
          )}

          {/* Le texte a ete retouche: les horodatages ne collent plus. */}
          {editedAway && (
            <p className="text-[11px] leading-relaxed text-ink-400">
              {t('editor:lyrics.timedLost')}
            </p>
          )}

          <button
            type="button"
            onClick={() => void reformat()}
            disabled={busy || key.trim().length === 0}
            className="min-h-11 w-full surface rounded-xl border border-ink-600 bg-ink-800 text-sm font-medium text-ink-200 active:bg-ink-700 disabled:opacity-60"
          >
            {t('editor:lyrics.reformat')}
          </button>

          <button
            type="button"
            onClick={() => {
              // Les horodatages du modele font autorite quand ils sont encore
              // valables: on les pose tels quels. Sinon on repasse par le
              // calage sur les beats.
              if (timed !== null && !editedAway) onLines(timed);
              else onText(result);
              setResult('');
              setTimed(null);
            }}
            className="min-h-11 w-full rounded-xl bg-beat-400 text-sm font-semibold text-ink-950 active:bg-beat-500"
          >
            {timed !== null && !editedAway
              ? t('editor:lyrics.useTimed')
              : t('editor:lyrics.useAi')}
          </button>
        </div>
      )}
    </div>
  );
}
