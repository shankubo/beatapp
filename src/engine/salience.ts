/**
 * Zone d'interet d'une image, par le DETAIL et non par la reconnaissance.
 *
 * Pourquoi pas une vraie detection de visage: mesure faite dans Chromium,
 * `FaceDetector` (API Shape Detection) n'existe pas — jamais activee par defaut
 * dans Chrome, jamais implementee par Firefox ni Safari. Les deux alternatives
 * sont refusees par les regles du projet: charger un modele (MediaPipe, ~10 Mo
 * de WebAssembly) est exactement la limite deja actee pour la transcription des
 * paroles, et un service distant contredirait « rien ne quitte votre appareil ».
 *
 * Ce que fait ce module a la place: mesurer ou se concentre le DETAIL. Sur un
 * portrait, le visage est presque toujours la zone la plus contrastee de la
 * photo — non parce qu'on l'a reconnu, mais parce qu'un fond est generalement
 * plus lisse qu'un visage. Le resultat est souvent le meme; l'honnetete du
 * nommage change, elle: c'est un centrage sur le detail, pas sur un visage.
 */

import type { FocalPoint } from '../domain/project';

/**
 * Cote de l'image reduite avant analyse.
 *
 * On ne travaille jamais sur la pleine resolution: le gradient d'une photo de
 * 12 Mpx coute des centaines de millisecondes pour un resultat identique. A
 * 64 px, une passe complete tient sous la milliseconde, et la position d'une
 * zone d'interet n'a pas besoin d'etre plus fine que ca.
 */
const ANALYSIS_SIZE = 64;

/**
 * Puissance appliquee au gradient avant la moyenne ponderee.
 *
 * A 1, un fond legerement texture pese autant qu'un sujet net simplement parce
 * qu'il occupe plus de surface, et le barycentre retombe au centre. En elevant
 * au carre, les zones franchement detaillees dominent — ce qui est precisement
 * ce qu'on cherche.
 */
const CONTRAST_EXPONENT = 2;

/**
 * Ecart-type minimal du gradient pour oser un recentrage.
 *
 * Sur une image uniforme (ciel, mur, degrade), le detail n'est nulle part et
 * partout a la fois: le barycentre y est un artefact numerique. Mieux vaut
 * renvoyer `null` et laisser le cadrage centre que deplacer l'image au hasard.
 */
const MIN_SALIENCE_SPREAD = 0.02;

/**
 * Barycentre du detail d'une image, en fraction de la source (0..1).
 *
 * Renvoie `null` quand aucune zone ne se distingue: l'appelant doit alors
 * conserver le cadrage centre plutot que d'inventer un deplacement.
 *
 * Le `try/catch` couvre le canvas teinte (`SecurityError` sur `getImageData`):
 * un import qui echoue a s'analyser doit degrader vers « centre », jamais faire
 * echouer l'import lui-meme.
 */
export function focalPointOf(source: ImageBitmap | HTMLCanvasElement): FocalPoint | null {
  try {
    return computeFocalPoint(source);
  } catch {
    return null;
  }
}

function computeFocalPoint(
  source: ImageBitmap | HTMLCanvasElement,
): FocalPoint | null {
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;

  // Reduction en preservant le rapport d'aspect: analyser une image deformee
  // deplacerait le barycentre vers l'axe etire.
  const scale = Math.min(1, ANALYSIS_SIZE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(2, Math.round(sourceWidth * scale));
  const height = Math.max(2, Math.round(sourceHeight * scale));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(source, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  // Luminance perceptuelle: un rouge vif et un bleu vif ne se valent pas a
  // l'oeil, et un gradient calcule sur la moyenne RVB inventerait des contours.
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i += 1) {
    const o = i * 4;
    luma[i] = 0.2126 * data[o]! + 0.7152 * data[o + 1]! + 0.0722 * data[o + 2]!;
  }

  let sumWeight = 0;
  let sumX = 0;
  let sumY = 0;
  const weights = new Float32Array(width * height);

  // Gradient par differences centrees, bords exclus: un bord n'a pas de voisin
  // des deux cotes, et le traiter comme un contour creerait un cadre fantome.
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const dx = luma[i + 1]! - luma[i - 1]!;
      const dy = luma[i + width]! - luma[i - width]!;
      const magnitude = Math.hypot(dx, dy) / 255;
      const weight = magnitude ** CONTRAST_EXPONENT;

      weights[i] = weight;
      sumWeight += weight;
      sumX += weight * (x + 0.5);
      sumY += weight * (y + 0.5);
    }
  }

  if (sumWeight <= 0) return null;

  // Dispersion: sans elle, une image uniforme renverrait un centre arbitraire.
  const mean = sumWeight / weights.length;
  let variance = 0;
  for (const weight of weights) variance += (weight - mean) ** 2;
  const spread = Math.sqrt(variance / weights.length);
  if (spread < MIN_SALIENCE_SPREAD) return null;

  return {
    x: Math.min(1, Math.max(0, sumX / sumWeight / width)),
    y: Math.min(1, Math.max(0, sumY / sumWeight / height)),
  };
}
