/**
 * Combien coute la detection de changements de plan ?
 *
 * Mesure et non estimation: le plan la donnait pour « non mesuree sur
 * telephone », et le choix de l'implementer en depend. On synthetise une video
 * de test, on la decode a cadence reduite, et on chronometre.
 *
 * Ce test n'assert presque rien: son role est de PRODUIRE un chiffre.
 */

import { describe, expect, it } from 'vitest';

/** Frames analysees par seconde de video. Voir le commentaire du resultat. */
const SAMPLE_FPS = 4;
const ANALYSIS_WIDTH = 32;
const ANALYSIS_HEIGHT = 57;

/** Empreinte d'une frame: luminance moyenne par case d'une grille. */
function fingerprint(ctx: CanvasRenderingContext2D): Float32Array {
  const { data } = ctx.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  const out = new Float32Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT);
  for (let i = 0; i < out.length; i += 1) {
    const p = i * 4;
    out[i] = 0.2126 * data[p]! + 0.7152 * data[p + 1]! + 0.0722 * data[p + 2]!;
  }
  return out;
}

describe('cout de la detection de plans', () => {
  it('chronometre le traitement d une frame', () => {
    const canvas = document.createElement('canvas');
    canvas.width = ANALYSIS_WIDTH;
    canvas.height = ANALYSIS_HEIGHT;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    expect(ctx).not.toBeNull();
    if (!ctx) return;

    // Frames de synthese: on mesure le cout du REDIMENSIONNEMENT et de la
    // lecture de pixels, qui domine — pas celui du decodage video lui-meme.
    const source = document.createElement('canvas');
    source.width = 1080;
    source.height = 1920;
    const sourceCtx = source.getContext('2d');
    if (!sourceCtx) return;

    const FRAMES = 20 * SAMPLE_FPS; // 20 s de video
    const started = performance.now();
    let previous: Float32Array | null = null;
    let cuts = 0;

    for (let i = 0; i < FRAMES; i += 1) {
      // Une nouvelle teinte toutes les 10 frames simule un changement de plan.
      sourceCtx.fillStyle = `hsl(${Math.floor(i / 10) * 60}, 60%, 50%)`;
      sourceCtx.fillRect(0, 0, source.width, source.height);

      ctx.drawImage(source, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      const current = fingerprint(ctx);

      if (previous) {
        let diff = 0;
        for (let p = 0; p < current.length; p += 1) {
          diff += Math.abs(current[p]! - previous[p]!);
        }
        if (diff / current.length > 12) cuts += 1;
      }
      previous = current;
    }

    const elapsed = performance.now() - started;
    console.log(
      `\n  ${FRAMES} frames (20 s a ${SAMPLE_FPS} fps) traitees en ${elapsed.toFixed(0)} ms` +
        `\n  soit ${(elapsed / FRAMES).toFixed(2)} ms par frame` +
        `\n  ${cuts} changements detectes\n`,
    );

    // La detection fonctionne sur ce signal de synthese.
    expect(cuts).toBeGreaterThan(0);
    // Garde-fou de non-regression: au-dela, l'approche serait a revoir.
    expect(elapsed).toBeLessThan(5000);
  });
});
