/**
 * Assistance IA pour les paroles.
 *
 * DEUX moteurs, et le premier est nettement meilleur pour cet usage:
 *
 * - **Groq / Whisper** transcrit l'audio ET renvoie des SEGMENTS HORODATES.
 *   Le calage vient donc du modele lui-meme: les lignes n'ont pas besoin de la
 *   grille rythmique, ce qui en fait la voie la plus precise de toutes.
 * - **Gemini** transcrit aussi, mais rend du texte nu. Les lignes repassent
 *   alors par `alignLyricsToBeats`, comme du texte colle.
 *
 * Attention au nom: **Groq** (`api.groq.com`, cles `gsk_...`) n'est pas **Grok**
 * de xAI (`api.x.ai`, cles `xai-...`). Deux entreprises distinctes aux noms
 * voisins. C'est Groq qui sert Whisper; xAI ne prend pas d'audio en entree, et
 * une cle de l'un est refusee par l'autre — verifie par une requete reelle.
 *
 * La cle appartient a l'utilisateur et n'est jamais dans le bundle. Une cle
 * embarquee dans une PWA est publique par construction: tout le JavaScript livre
 * est lisible, aucune obfuscation n'y change rien, et le quota serait consomme
 * par des tiers des la mise en ligne.
 *
 * Ce module est le SEUL endroit de l'application qui envoie des donnees vers
 * l'exterieur. Partout ailleurs le flux est descendant (on telecharge un
 * fichier). L'interface doit donc le dire explicitement avant chaque appel.
 */

import { newId } from '../../lib/id';
import type { LyricLine, LyricWord, Seconds } from '../../domain/types';

export type AiProvider = 'groq' | 'gemini';

/** Modeles utilises. Ecrits ici et non disperses dans l'interface. */
const GEMINI_MODEL = 'gemini-2.5-flash';
/**
 * `turbo`: mesure a 3,3 s pour 163 s d'audio, pour une qualite equivalente au
 * modele complet sur du chant. Sur mobile, cette latence compte.
 */
const WHISPER_MODEL = 'whisper-large-v3-turbo';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_TRANSCRIBE_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_CHAT_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
/** Modele de texte de Groq, pour le redecoupage en lignes. */
const GROQ_TEXT_MODEL = 'llama-3.3-70b-versatile';

/**
 * Plafond de taille de l'audio envoye.
 *
 * Le plus contraignant des deux moteurs fait loi, pour qu'une bascule de moteur
 * ne fasse jamais echouer un audio qui passait:
 * - Groq accepte 25 Mo, en `multipart` — donc sans surcout d'encodage;
 * - Gemini accepte environ 20 Mo de requete, base64 COMPRIS, et le base64
 *   gonfle de 33 %: l'audio utile y est donc plafonne vers 14 Mo.
 *
 * Verifie AVANT tout encodage: sinon on construirait en memoire une chaine de
 * plusieurs dizaines de mega-octets pour la jeter ensuite.
 */
export const MAX_AI_AUDIO_BYTES = 12 * 1024 * 1024;

/** Duree maximale envoyee. Un reel n'a jamais besoin de plus. */
export const MAX_AI_AUDIO_SECONDS: Seconds = 300;

export type AiErrorKey =
  | 'errors:ai.noKey'
  | 'errors:ai.tooLarge'
  | 'errors:ai.tooLong'
  | 'errors:ai.unauthorized'
  | 'errors:ai.rateLimited'
  | 'errors:ai.noAudioSupport'
  | 'errors:ai.emptyResult'
  | 'errors:ai.requestFailed';

/** Erreur portant une cle de traduction: l'interface n'invente aucun message. */
export class AiError extends Error {
  constructor(readonly i18nKey: AiErrorKey) {
    super(i18nKey);
    this.name = 'AiError';
  }
}

/**
 * Consigne de transcription, pour GEMINI seulement.
 *
 * On lui demande du texte NU: ses horodatages, quand il en produit, sont
 * approximatifs. Le calage repasse donc par la grille rythmique mesuree de
 * l'application. Whisper, lui, n'a pas besoin de consigne — il renvoie ses
 * propres segments datees, et ceux-la font autorite.
 */
const TRANSCRIBE_PROMPT = [
  'Transcris les paroles chantees de cet audio.',
  'Une ligne par phrase chantee, dans la langue chantee.',
  'Ne numerote pas. N ajoute ni horodatage, ni commentaire, ni titre.',
  'Si aucune parole n est chantee, reponds exactement: (aucune parole)',
].join(' ');

/** Consigne de mise en forme: on ne reecrit pas, on redecoupe. */
const FORMAT_PROMPT = [
  'Redecoupe ces paroles en lignes courtes et chantables.',
  'Ne change AUCUN mot: seuls les retours a la ligne et la ponctuation peuvent bouger.',
  'Une ligne par phrase. Ne numerote pas. N ajoute aucun commentaire.',
].join(' ');

/** Marqueur renvoye par le modele quand l'audio ne contient pas de chant. */
const NO_LYRICS = '(aucune parole)';

/**
 * Resultat d'une transcription.
 *
 * `lines` n'est renseigne que par Whisper, qui date ses segments. Quand il est
 * present, il FAIT AUTORITE et ne doit pas etre recale sur les beats: le modele
 * a entendu ou tombent reellement les phrases, ce qu'aucune grille deduite ne
 * peut egaler.
 */
export interface Transcription {
  text: string;
  lines?: LyricLine[];
}

export async function transcribeAudio(
  blob: Blob,
  options: {
    provider: AiProvider;
    apiKey: string;
    duration?: Seconds;
    signal?: AbortSignal;
  },
): Promise<Transcription> {
  const { provider, apiKey, duration, signal } = options;
  if (apiKey.trim().length === 0) throw new AiError('errors:ai.noKey');

  // Verifie AVANT tout encodage, qui gonflerait l'empreinte memoire.
  if (blob.size > MAX_AI_AUDIO_BYTES) throw new AiError('errors:ai.tooLarge');
  if (duration !== undefined && duration > MAX_AI_AUDIO_SECONDS) {
    throw new AiError('errors:ai.tooLong');
  }

  return provider === 'groq'
    ? transcribeWithWhisper(blob, apiKey, signal)
    : transcribeWithGemini(blob, apiKey, signal);
}

/**
 * Groq / Whisper: transcription AVEC horodatage.
 *
 * L'envoi se fait en `multipart/form-data` et non en JSON: le blob part tel
 * quel, sans passer par base64. C'est la difference qui compte sur mobile —
 * l'encodage base64 aurait ajoute un tiers de volume et une copie complete du
 * fichier en memoire.
 */
async function transcribeWithWhisper(
  blob: Blob,
  apiKey: string,
  signal?: AbortSignal,
): Promise<Transcription> {
  const form = new FormData();
  // Le nom de fichier DOIT porter une extension reconnue: l'API valide le format
  // dessus et non sur le contenu. Un nom sans extension est refuse par un 400
  // « file must be one of the following types » — mesure, pas suppose.
  form.append('file', blob, `audio.${audioExtension(blob.type)}`);
  form.append('model', WHISPER_MODEL);
  // `verbose_json` est ce qui apporte les segments datees. Sans lui on n'aurait
  // que du texte, et l'interet de ce moteur disparaitrait.
  form.append('response_format', 'verbose_json');
  // Granularite au MOT en plus du segment: c'est ce qui rend le karaoke
  // possible. Demander les deux est necessaire — ne demander que `word` prive
  // des segments, qui restent la base du decoupage en lignes.
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');

  let response: Response;
  try {
    response = await fetch(GROQ_TRANSCRIBE_ENDPOINT, {
      method: 'POST',
      // Pas de `Content-Type` pose a la main: `fetch` doit calculer lui-meme la
      // frontiere du multipart, et l'ecrire casserait la requete.
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
    });
  } catch {
    throw new AiError('errors:ai.requestFailed');
  }

  if (!response.ok) throw statusError(response.status);

  let payload: WhisperResponse;
  try {
    payload = (await response.json()) as WhisperResponse;
  } catch {
    throw new AiError('errors:ai.requestFailed');
  }

  const segments = payload.segments ?? [];
  const lines = segmentsToLines(segments, payload.words ?? []);
  const text =
    lines.length > 0
      ? lines.map((line) => line.text).join('\n')
      : (payload.text ?? '').trim();

  if (text.length === 0) throw new AiError('errors:ai.emptyResult');

  return lines.length > 0 ? { text, lines } : { text };
}

/** Gemini: transcription en texte nu, a recaler ensuite sur les beats. */
async function transcribeWithGemini(
  blob: Blob,
  apiKey: string,
  signal?: AbortSignal,
): Promise<Transcription> {
  const audio = await blobToBase64(blob);

  const response = await request(`${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent`, {
    // La cle passe par un en-tete et non par la query string: une URL se
    // retrouve dans les journaux de serveur et l'historique du navigateur.
    headers: { 'x-goog-api-key': apiKey },
    body: {
      contents: [
        {
          parts: [
            { text: TRANSCRIBE_PROMPT },
            // `mimeType` vient du blob lui-meme, deja valide par magic bytes a
            // l'import: on ne fait pas confiance a un nom de fichier.
            { inlineData: { mimeType: blob.type || 'audio/mpeg', data: audio } },
          ],
        },
      ],
      // Temperature nulle: une transcription n'a pas a etre creative.
      generationConfig: { temperature: 0 },
    },
    signal,
  });

  const text = geminiText(response);
  if (text === null || text.length === 0) throw new AiError('errors:ai.emptyResult');
  if (text.toLowerCase().includes(NO_LYRICS)) throw new AiError('errors:ai.emptyResult');
  return { text };
}

/**
 * Convertit les segments de Whisper en lignes de paroles.
 *
 * Les segments vides sont ecartes: Whisper en produit sur les passages
 * instrumentaux, et une ligne vide affichee a l'ecran ressemblerait a un bug.
 */
function segmentsToLines(
  segments: readonly WhisperSegment[],
  words: readonly WhisperWord[],
): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const segment of segments) {
    const text = (segment.text ?? '').trim();
    if (text.length === 0) continue;

    const start = Math.max(0, segment.start ?? 0);
    const end = segment.end ?? start;

    /**
     * Mots tombant dans ce segment.
     *
     * On rattache par le TEMPS et non par un index: les deux listes de Whisper
     * sont independantes, et rien ne garantit qu'un decoupage en segments
     * corresponde a un decoupage en mots. Le critere est le milieu du mot, ce
     * qui evite qu'un mot a cheval sur une frontiere soit compte deux fois.
     */
    const owned: LyricWord[] = words
      .filter((word) => {
        const wordStart = word.start ?? 0;
        const wordEnd = word.end ?? wordStart;
        const middle = (wordStart + wordEnd) / 2;
        return middle >= start && middle < Math.max(end, start + 1e-6);
      })
      .map((word) => ({
        text: (word.word ?? '').trim(),
        start: Math.max(0, word.start ?? 0),
        end: Math.max(word.start ?? 0, word.end ?? 0),
      }))
      .filter((word) => word.text.length > 0);

    lines.push({
      id: newId('lyric'),
      text,
      start,
      // Un segment de duree nulle ou negative (arrondi du modele) recoit un
      // minimum lisible plutot que de disparaitre.
      duration: Math.max(MIN_SEGMENT_DURATION, end - start),
      // Absent plutot que vide quand aucun mot n'a ete rattache: `sungFraction`
      // se rabat alors sur un balayage regulier, ce qui vaut mieux qu'un
      // surlignage fige.
      ...(owned.length > 0 ? { words: owned } : {}),
    });
  }

  return lines;
}

/** Duree plancher d'une ligne issue d'un segment. */
const MIN_SEGMENT_DURATION: Seconds = 0.3;

/**
 * Extension a donner au fichier envoye, deduite de son type MIME.
 *
 * L'API valide le format sur l'EXTENSION du nom de fichier, pas sur le contenu:
 * un nom sans extension est rejete par un 400. Le type MIME du blob est fiable
 * ici — il vient de la validation par magic bytes faite a l'import.
 *
 * `mp3` par defaut: c'est le format le plus courant, et un type inconnu a plus
 * de chances d'etre un MP3 mal etiquete que d'echouer sur cette valeur.
 */
export function audioExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/webm': 'webm',
  };
  // On ecarte les parametres eventuels (`audio/ogg; codecs=opus`).
  const base = mimeType.split(';')[0]!.trim().toLowerCase();
  return map[base] ?? 'mp3';
}

/**
 * Redecoupe un texte de paroles en lignes chantables.
 *
 * Disponible sur les deux moteurs: c'est du texte vers du texte. Utile apres une
 * transcription dont le decoupage ne suit pas les phrases chantees, ou sur des
 * paroles collees d'un seul bloc.
 *
 * ATTENTION: redecouper une transcription Whisper DETRUIT ses horodatages, les
 * lignes ne correspondant plus aux segments. L'appelant doit donc repasser par
 * le calage sur les beats — c'est pourquoi l'interface distingue les deux cas.
 */
export async function formatLyrics(
  raw: string,
  options: { provider: AiProvider; apiKey: string; signal?: AbortSignal },
): Promise<string> {
  const { provider, apiKey, signal } = options;
  if (apiKey.trim().length === 0) throw new AiError('errors:ai.noKey');
  if (raw.trim().length === 0) throw new AiError('errors:ai.emptyResult');

  const text =
    provider === 'gemini'
      ? await formatWithGemini(raw, apiKey, signal)
      : await formatWithGroqChat(raw, apiKey, signal);

  if (text.length === 0) throw new AiError('errors:ai.emptyResult');
  return text;
}

async function formatWithGemini(
  raw: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await request(`${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent`, {
    headers: { 'x-goog-api-key': apiKey },
    body: {
      contents: [{ parts: [{ text: `${FORMAT_PROMPT}\n\n${raw}` }] }],
      generationConfig: { temperature: 0 },
    },
    signal,
  });
  return geminiText(response) ?? '';
}

async function formatWithGroqChat(
  raw: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await request(GROQ_CHAT_ENDPOINT, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body: {
      model: GROQ_TEXT_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: FORMAT_PROMPT },
        { role: 'user', content: raw },
      ],
    },
    signal,
  });

  const content = (response as ChatResponse).choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/**
 * Reponse `verbose_json` de Whisper.
 *
 * `segments` porte le decoupage en phrases, `words` le decoupage au mot. Les
 * deux listes sont INDEPENDANTES: on les recoupe par le temps, jamais par index.
 */
interface WhisperResponse {
  text?: string;
  segments?: WhisperSegment[];
  words?: WhisperWord[];
}

interface WhisperSegment {
  start?: number;
  end?: number;
  text?: string;
}

interface WhisperWord {
  word?: string;
  start?: number;
  end?: number;
}

/** Format OpenAI, utilise par le modele de texte de Groq. */
interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

/** Extrait le texte d'une reponse Gemini, en tolerant plusieurs parts. */
function geminiText(response: unknown): string | null {
  const parts = (response as GeminiResponse).candidates?.[0]?.content?.parts;
  if (!parts) return null;
  const text = parts
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  return text.length > 0 ? text : null;
}

/**
 * Appel HTTP commun aux deux moteurs.
 *
 * `credentials: 'omit'` et `referrerPolicy: 'no-referrer'`: la requete ne doit
 * emporter ni cookie ni provenance. C'est la meme discipline que l'import par
 * lien, qui est l'autre — et jusqu'ici la seule — sortie du navigateur.
 */
async function request(
  url: string,
  options: { headers: Record<string, string>; body: unknown; signal?: AbortSignal },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: JSON.stringify(options.body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: options.signal,
    });
  } catch {
    // Reseau coupe, CORS, ou annulation: rien d'exploitable a distinguer ici.
    throw new AiError('errors:ai.requestFailed');
  }

  if (!response.ok) throw statusError(response.status);

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new AiError('errors:ai.requestFailed');
  }
}

/**
 * Traduit un code HTTP en cause actionnable.
 *
 * Les trois cas distingues sont ceux ou l'utilisateur peut FAIRE quelque chose:
 * corriger sa cle, attendre, ou reduire l'audio. Le reste est indifferencie,
 * parce qu'un message plus precis n'ouvrirait aucune action.
 */
function statusError(status: number): AiError {
  if (status === 401 || status === 403) return new AiError('errors:ai.unauthorized');
  if (status === 429) return new AiError('errors:ai.rateLimited');
  if (status === 413) return new AiError('errors:ai.tooLarge');
  return new AiError('errors:ai.requestFailed');
}

/**
 * Encode un blob en base64, par morceaux.
 *
 * `String.fromCharCode(...bytes)` sur un tableau de plusieurs mega-octets
 * depasse la limite d'arguments et leve un `RangeError`: d'ou le decoupage.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;

  let binary = '';
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}
