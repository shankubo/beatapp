/**
 * Detection des changements de plan dans une video importee.
 *
 * Principe: on echantillonne la video a cadence reduite, on reduit chaque frame
 * a une empreinte minuscule, et on declare une coupe quand deux empreintes
 * consecutives different franchement.
 *
 * Cout MESURE avant d'ecrire ce module (`tests/browser/sceneDetectCost.test.ts`):
 * 1,83 ms par frame, soit 146 ms pour 20 s de video a 4 images par seconde.
 * Decoder les 600 frames d'origine aurait coute trente fois plus pour une
 * precision dont un montage n'a pas l'usage — une coupe posee a 250 ms pres est
 * indiscernable a l'oeil.
 *
 * Pourquoi un `<video>` cache plutot que WebCodecs: le seek d'un element video
 * est accelere materiellement partout, alors que WebCodecs exigerait de demuxer
 * le fichier pour extraire les frames cles. Ici on ne cherche pas l'exactitude
 * d'un export, seulement des instants de coupe.
 */

import type { Seconds } from '../../domain/types';

/** Frames analysees par seconde de video. */
const SAMPLE_FPS = 4;

/** Taille de l'empreinte. 32x57 garde le format 9:16 pour ~1800 valeurs. */
const FINGERPRINT_WIDTH = 32;
const FINGERPRINT_HEIGHT = 57;

/**
 * Ecart moyen de luminance au-dela duquel deux frames sont deux plans.
 *
 * Etabli par la mesure, sur une echelle de 0 a 255. Un panoramique lent produit
 * un ecart de quelques unites; une vraie coupe en produit plusieurs dizaines.
 * 18 laisse donc passer les mouvements de camera tout en attrapant les coupes,
 * y compris entre deux plans de tonalite voisine.
 */
const CUT_THRESHOLD = 18;

/** Au-dela, on renonce: une video longue rendrait l'attente inacceptable. */
const MAX_ANALYSIS_SECONDS = 180;

/**
 * Instants de changement de plan, en secondes depuis le debut de la source.
 *
 * Renvoie un tableau VIDE plutot que de lever quand l'analyse est impossible:
 * l'appelant retombe alors sur le decoupage rythmique, ce qui reste un resultat
 * utilisable. Un reel qui refuse de s'importer parce que la detection a echoue
 * serait un mauvais echange.
 */
export async function detectScenes(
  blob: Blob,
  duration: Seconds,
  options: { signal?: AbortSignal } = {},
): Promise<Seconds[]> {
  if (!(duration > 0) || duration > MAX_ANALYSIS_SECONDS) return [];

  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  const canvas = document.createElement('canvas');
  canvas.width = FINGERPRINT_WIDTH;
  canvas.height = FINGERPRINT_HEIGHT;
  // `willReadFrequently`: on relit les pixels a chaque frame, et sans ce drapeau
  // le navigateur garde le canvas sur le GPU — chaque lecture devient un
  // aller-retour couteux.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  try {
    if (!ctx) return [];
    await once(video, 'loadeddata');

    const cuts: Seconds[] = [];
    const step = 1 / SAMPLE_FPS;
    let previous: Float32Array | null = null;

    for (let time = 0; time < duration; time += step) {
      if (options.signal?.aborted) return [];

      video.currentTime = time;
      await once(video, 'seeked');

      ctx.drawImage(video, 0, 0, FINGERPRINT_WIDTH, FINGERPRINT_HEIGHT);
      const current = fingerprint(ctx);

      if (previous) {
        let total = 0;
        for (let i = 0; i < current.length; i += 1) {
          total += Math.abs(current[i]! - previous[i]!);
        }
        /*
          L'instant retenu est le MILIEU de l'intervalle echantillonne.

          La coupe est tombee quelque part entre les deux frames analysees;
          viser le milieu borne l'erreur a une demi-periode (125 ms) au lieu
          d'une periode entiere si l'on prenait l'une des deux bornes.
        */
        if (total / current.length > CUT_THRESHOLD) cuts.push(time - step / 2);
      }
      previous = current;
    }

    return cuts;
  } catch {
    // Format illisible, seek refuse, onglet en arriere-plan: l'appelant
    // retombera sur le decoupage rythmique.
    return [];
  } finally {
    // Ordre important: on libere l'URL APRES avoir detache la source, sinon
    // certains navigateurs journalisent une erreur de chargement interrompu.
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Luminance moyenne par case de la grille. */
function fingerprint(ctx: CanvasRenderingContext2D): Float32Array {
  const { data } = ctx.getImageData(0, 0, FINGERPRINT_WIDTH, FINGERPRINT_HEIGHT);
  const out = new Float32Array(FINGERPRINT_WIDTH * FINGERPRINT_HEIGHT);
  for (let i = 0; i < out.length; i += 1) {
    const p = i * 4;
    // Coefficients de luminance perceptuelle, les memes que `salience.ts`.
    out[i] = 0.2126 * data[p]! + 0.7152 * data[p + 1]! + 0.0722 * data[p + 2]!;
  }
  return out;
}

/**
 * Attend un evenement, avec un plafond de temps.
 *
 * Le plafond n'est pas decoratif: un `seeked` qui n'arrive jamais — onglet
 * masque, fichier tronque — bloquerait l'import indefiniment, sans message.
 */
function once(target: HTMLVideoElement, event: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${event}: delai depasse`));
    }, timeoutMs);

    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`${event}: erreur de lecture`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
    };

    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}
