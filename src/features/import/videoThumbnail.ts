/**
 * Extraction d'une vignette de video.
 *
 * Un `<video preload="metadata">` n'affiche PAS sa premiere frame de facon
 * fiable: sur Chrome Android et sur iOS il reste noir tant que la lecture n'a
 * pas commence, et la liste des medias semblait alors ne contenir que des cases
 * vides. On decode donc une frame explicitement et on la fige dans un blob.
 *
 * La frame est prise legerement APRES le debut: beaucoup de videos commencent
 * par un fondu au noir, et une vignette noire ne se distingue pas d'un echec.
 */

/** Instant de la frame extraite, en secondes. */
const SEEK_TIME = 0.15;

/** Cote maximal de la vignette. Au-dela, on paierait un decodage pour rien. */
const MAX_SIDE = 320;

/**
 * Delai maximal accorde au decodage.
 *
 * Un fichier corrompu peut ne jamais emettre `seeked`: sans plafond, la promesse
 * resterait en suspens et la vignette tournerait indefiniment.
 */
const TIMEOUT_MS = 5_000;

/**
 * Rend une frame de `blob` en vignette JPEG, ou `null` si le decodage echoue.
 *
 * Ne leve jamais: une vignette est un agrement, et un fichier illisible doit
 * degrader l'affichage, pas casser la liste.
 */
export async function extractVideoThumbnail(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');

  try {
    // `muted` + `playsInline` sont requis pour que le decodage soit autorise
    // sans geste utilisateur sur mobile.
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;

    await decodeFrame(video);

    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.72);
    });
  } catch {
    return null;
  } finally {
    // L'ordre compte: on detache la source AVANT de revoquer l'URL, sinon
    // certains navigateurs continuent de telecharger un blob deja libere.
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Attend qu'une frame soit reellement decodee et prete a etre dessinee. */
function decodeFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    const onSeeked = () => {
      cleanup();
      resolve();
    };

    const onLoaded = () => {
      // Une video plus courte que `SEEK_TIME` reste sur sa frame courante:
      // `seeked` ne serait jamais emis, on se contente donc de celle-ci.
      if (!Number.isFinite(video.duration) || video.duration <= SEEK_TIME) {
        cleanup();
        resolve();
        return;
      }
      video.currentTime = SEEK_TIME;
    };

    const onError = () => {
      cleanup();
      reject(new Error('decode'));
    };

    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
  });
}
