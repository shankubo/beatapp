/**
 * Fournit les ressources media vivantes: blobs, cache de frames, buffers audio.
 *
 * Ce contexte detient les objets NON serialisables (ImageBitmap, AudioBuffer,
 * elements video), la ou le store Zustand ne contient que des donnees
 * persistables. La separation est deliberee: melanger les deux ferait echouer
 * l'autosave et fuiter la memoire GPU.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { RealtimeMediaCache, downscaleToFrame } from '../../engine/MediaCache';
import { decodeAudioBlob } from '../../export/audioMix';
import { getMedia } from '../../storage/mediaStore';
import type { Id, MediaAsset, Project } from '../../domain/types';

interface MediaContextValue {
  cache: RealtimeMediaCache;
  /** Blobs des medias, pour les vignettes et l'export. */
  blobs: ReadonlyMap<Id, Blob>;
  /** Buffers audio decodes, pour la lecture et l'analyse. */
  audioBuffers: ReadonlyMap<Id, AudioBuffer>;
  /** Contexte audio partage: un seul par application. */
  audioContext: AudioContext;
  /** Enregistre un media fraichement importe (blob deja en memoire). */
  register: (asset: MediaAsset, blob: Blob) => Promise<void>;
  /**
   * Libere tous les medias en memoire.
   *
   * Appele par « Nouveau »: sans cela, les `ImageBitmap` et `AudioBuffer` de
   * l'ancien projet resteraient en memoire GPU et RAM pour toute la duree de la
   * session, et le nouveau projet demarrerait avec l'empreinte de l'ancien.
   */
  reset: () => void;
  /** Vrai pendant le chargement initial des medias d'un projet. */
  loading: boolean;
  /**
   * Incremente a chaque media devenu utilisable.
   *
   * L'apercu s'en sert pour se redessiner: un `ImageBitmap` decode n'est pas un
   * etat React, donc sans ce signal le canvas resterait noir jusqu'a la
   * prochaine interaction.
   */
  readyRevision: number;
}

const MediaContext = createContext<MediaContextValue | null>(null);

export function useMedia(): MediaContextValue {
  const value = useContext(MediaContext);
  if (!value) throw new Error('useMedia doit etre utilise dans un MediaProvider');
  return value;
}

/** Resolution de decodage des images: inutile de garder du 12 Mpx en memoire. */
const MAX_IMAGE_WIDTH = 1080;
const MAX_IMAGE_HEIGHT = 1920;

export function MediaProvider({
  project,
  children,
}: {
  project: Project;
  children: ReactNode;
}) {
  const cacheRef = useRef<RealtimeMediaCache | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  /**
   * Acces paresseux aux ressources natives.
   *
   * Passer par des accesseurs plutot que par `ref.current!` garantit qu'apres un
   * demontage (qui remet les refs a zero) le remontage recree des ressources
   * vivantes, au lieu de reutiliser un cache deja libere.
   */
  const getCache = useCallback((): RealtimeMediaCache => {
    cacheRef.current ??= new RealtimeMediaCache();
    return cacheRef.current;
  }, []);

  // Un seul AudioContext a la fois: les navigateurs en limitent le nombre.
  const getAudioContext = useCallback((): AudioContext => {
    audioContextRef.current ??= new AudioContext();
    return audioContextRef.current;
  }, []);

  const [blobs, setBlobs] = useState<Map<Id, Blob>>(() => new Map());
  const [audioBuffers, setAudioBuffers] = useState<Map<Id, AudioBuffer>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [readyRevision, setReadyRevision] = useState(0);

  /** Charge un media dans le cache selon son type. */
  const ingest = useCallback(async (asset: MediaAsset, blob: Blob) => {
    const cache = getCache();
    const context = getAudioContext();

    if (asset.kind === 'image') {
      const bitmap = await downscaleToFrame(blob, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT);
      cache.registerImage(asset.id, bitmap);
      setReadyRevision((n) => n + 1);
      return;
    }

    if (asset.kind === 'video') {
      cache.registerVideo(asset.id, blob);
      setReadyRevision((n) => n + 1);

      /**
       * Son d'origine de la video, decode a part.
       *
       * `registerVideo` ne prepare que les frames: l'element `<video>` du cache
       * est muet par construction. Sans ce decodage, une piste « son d'origine »
       * ne trouverait aucun buffer et resterait silencieuse.
       *
       * Le decodage ne se declenche que si le conteneur porte bel et bien une
       * piste sonore — sonde a l'import — et il n'interrompt pas le reste: une
       * video dont l'audio est illisible doit rester utilisable pour son image.
       */
      if (asset.hasAudio === true) {
        try {
          const buffer = await decodeAudioBlob(blob, context);
          setAudioBuffers((previous) => new Map(previous).set(asset.id, buffer));
        } catch {
          // Image conservee, son abandonne: c'est le bon compromis ici.
        }
      }
      return;
    }

    const buffer = await decodeAudioBlob(blob, context);
    setAudioBuffers((previous) => new Map(previous).set(asset.id, buffer));
  }, [getCache, getAudioContext]);

  const register = useCallback(
    async (asset: MediaAsset, blob: Blob) => {
      setBlobs((previous) => new Map(previous).set(asset.id, blob));
      await ingest(asset, blob);
    },
    [ingest],
  );

  /**
   * Vide le cache media sans detruire le contexte audio.
   *
   * Le `AudioContext` est conserve: il est cree sur un geste utilisateur, et le
   * recreer hors geste le laisserait suspendu — la lecture du nouveau projet
   * serait muette.
   */
  const reset = useCallback(() => {
    cacheRef.current?.dispose();
    cacheRef.current = null;
    setBlobs(new Map());
    setAudioBuffers(new Map());
    setReadyRevision(0);
  }, []);

  // Charge depuis le stockage les medias du projet qui ne sont pas encore en
  // memoire (reprise apres rechargement de l'onglet).
  const assetList = useMemo(() => Object.values(project.assets), [project.assets]);

  useEffect(() => {
    const missing = assetList.filter((asset) => !blobs.has(asset.id));
    if (missing.length === 0) return;

    let cancelled = false;
    setLoading(true);

    void (async () => {
      for (const asset of missing) {
        if (cancelled) return;
        try {
          const blob = await getMedia(asset.storage);
          // Media absent du stockage: `pruneDanglingClips` nettoiera le projet.
          if (!blob) continue;

          if (cancelled) return;
          setBlobs((previous) => new Map(previous).set(asset.id, blob));
          await ingest(asset, blob);
        } catch {
          // Un media illisible ne doit pas empecher les autres de charger.
        }
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `blobs` est volontairement exclu: l'inclure relancerait l'effet a chaque
    // media charge, et donc a chaque iteration de la boucle ci-dessus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetList, ingest]);

  /**
   * Liberation des ressources natives (ImageBitmap, elements video, objectURL,
   * AudioContext) a la destruction du provider.
   *
   * Les refs sont REMISES A ZERO en meme temps. C'est indispensable: en mode
   * strict, React monte, demonte puis remonte le composant. Sans cette remise a
   * zero, `cacheRef.current` pointait encore sur le cache deja vide par
   * `dispose()`, et l'apercu restait noir indefiniment — les bitmaps etaient
   * decodes puis jetes, sans qu'aucune erreur ne le signale.
   */
  useEffect(() => {
    return () => {
      cacheRef.current?.dispose();
      cacheRef.current = null;

      void audioContextRef.current?.close();
      audioContextRef.current = null;

      // Les blobs et buffers deja charges referencent des ressources liberees:
      // on repart d'un etat vide pour que le remontage recharge proprement.
      setBlobs(new Map());
      setAudioBuffers(new Map());
      setReadyRevision(0);
    };
  }, []);

  const value = useMemo<MediaContextValue>(
    () => ({
      cache: getCache(),
      blobs,
      audioBuffers,
      audioContext: getAudioContext(),
      register,
      reset,
      loading,
      readyRevision,
    }),
    [blobs, audioBuffers, register, reset, loading, readyRevision, getCache, getAudioContext],
  );

  return <MediaContext.Provider value={value}>{children}</MediaContext.Provider>;
}
