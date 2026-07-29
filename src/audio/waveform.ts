/**
 * Calcul des pics de forme d'onde pour l'affichage.
 *
 * On ne dessine jamais les echantillons bruts: un morceau de 3 minutes en
 * contient 8 millions pour environ 350 pixels de large. On reduit en "buckets"
 * de min/max, ce qui preserve l'aspect visuel du signal a cout constant.
 */

export interface WaveformPeaks {
  /** Valeur minimale de chaque bucket, dans [-1, 0]. */
  min: Float32Array;
  /** Valeur maximale de chaque bucket, dans [0, 1]. */
  max: Float32Array;
  /** Nombre de buckets. */
  length: number;
}

/**
 * Reduit un canal audio en `bucketCount` paires min/max.
 *
 * On calcule sur un seul canal: la difference visuelle avec une reduction
 * stereo est imperceptible a cette echelle, pour la moitie du travail.
 */
export function computePeaks(buffer: AudioBuffer, bucketCount: number): WaveformPeaks {
  const count = Math.max(1, Math.floor(bucketCount));
  const min = new Float32Array(count);
  const max = new Float32Array(count);

  const data = buffer.getChannelData(0);
  const samplesPerBucket = data.length / count;

  for (let bucket = 0; bucket < count; bucket += 1) {
    const from = Math.floor(bucket * samplesPerBucket);
    const to = Math.min(data.length, Math.floor((bucket + 1) * samplesPerBucket));

    let bucketMin = 0;
    let bucketMax = 0;
    for (let i = from; i < to; i += 1) {
      const sample = data[i]!;
      if (sample < bucketMin) bucketMin = sample;
      else if (sample > bucketMax) bucketMax = sample;
    }

    min[bucket] = bucketMin;
    max[bucket] = bucketMax;
  }

  return { min, max, length: count };
}

/**
 * Extrait les pics d'une portion du buffer, pour afficher un extrait trimme.
 * `from` et `to` sont en secondes.
 */
export function computePeaksForRange(
  buffer: AudioBuffer,
  from: number,
  to: number,
  bucketCount: number,
): WaveformPeaks {
  const count = Math.max(1, Math.floor(bucketCount));
  const min = new Float32Array(count);
  const max = new Float32Array(count);

  const data = buffer.getChannelData(0);
  const startSample = Math.max(0, Math.floor(from * buffer.sampleRate));
  const endSample = Math.min(data.length, Math.ceil(to * buffer.sampleRate));
  const span = Math.max(1, endSample - startSample);
  const samplesPerBucket = span / count;

  for (let bucket = 0; bucket < count; bucket += 1) {
    const bucketStart = startSample + Math.floor(bucket * samplesPerBucket);
    const bucketEnd = Math.min(endSample, startSample + Math.floor((bucket + 1) * samplesPerBucket));

    let bucketMin = 0;
    let bucketMax = 0;
    for (let i = bucketStart; i < bucketEnd; i += 1) {
      const sample = data[i]!;
      if (sample < bucketMin) bucketMin = sample;
      else if (sample > bucketMax) bucketMax = sample;
    }

    min[bucket] = bucketMin;
    max[bucket] = bucketMax;
  }

  return { min, max, length: count };
}

/**
 * Dessine une forme d'onde dans un canvas.
 *
 * Rendu en barres verticales plutot qu'en trace continu: c'est plus lisible a
 * faible hauteur (34 px dans la coquille mobile) et bien moins couteux.
 */
export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  peaks: WaveformPeaks,
  options: { width: number; height: number; color: string; background?: string },
): void {
  const { width, height, color, background } = options;

  ctx.clearRect(0, 0, width, height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }

  const middle = height / 2;
  const barWidth = width / peaks.length;

  ctx.fillStyle = color;
  for (let i = 0; i < peaks.length; i += 1) {
    const top = middle - peaks.max[i]! * middle;
    const bottom = middle - peaks.min[i]! * middle;
    // Hauteur minimale d'un pixel: un passage silencieux reste visible comme
    // une ligne, plutot que de disparaitre completement.
    const barHeight = Math.max(1, bottom - top);
    ctx.fillRect(i * barWidth, top, Math.max(1, barWidth - 0.5), barHeight);
  }
}
