/**
 * L'extraction du son d'une video ne doit RIEN perdre quand elle peut recopier.
 *
 * La piste audio d'une video est presque toujours deja en AAC dans un MP4:
 * mediabunny la remet alors telle quelle dans le conteneur de sortie, sans la
 * decoder. Ce test le verifie en comparant les ECHANTILLONS decodes de part et
 * d'autre — comparer les octets serait faux, les entetes de conteneur differant
 * toujours.
 *
 * Sans ce controle, un `forceTranscode` ajoute par megarde ferait perdre une
 * generation a chaque extraction, de facon parfaitement invisible.
 */

import { describe, expect, it } from 'vitest';

import { extractAudioFromVideo } from '@/features/audio/extractAudio';

/** Fabrique un MP4 audio-seul avec l'encodeur du navigateur. */
async function makeAacFile(): Promise<File> {
  const { AudioBufferSource, Output, BufferTarget, Mp4OutputFormat } = await import('mediabunny');

  const ctx = new OfflineAudioContext(1, 48000, 48000);
  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  osc.connect(ctx.destination);
  osc.start();
  const rendered = await ctx.startRendering();

  const source = new AudioBufferSource({ codec: 'aac', bitrate: 192_000 });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  output.addAudioTrack(source);
  await output.start();
  await source.add(rendered);
  source.close();
  await output.finalize();

  return new File([output.target.buffer!], 'source.mp4', { type: 'video/mp4' });
}

/** Premier canal decode d'un blob audio. */
async function samples(blob: Blob): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 48000, 48000);
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  return decoded.getChannelData(0);
}

describe('extractAudioFromVideo', () => {
  it('recopie la piste AAC sans la reencoder', async () => {
    const file = await makeAacFile();
    const extracted = await extractAudioFromVideo(file);

    const before = await samples(file);
    const after = await samples(extracted);

    const n = Math.min(before.length, after.length);
    expect(n).toBeGreaterThan(1000);

    let maxDiff = 0;
    for (let i = 0; i < n; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(before[i]! - after[i]!));
    }

    // Recopie exacte: les echantillons sont bit a bit identiques. Un
    // reencodage produirait un ecart de l'ordre de 1e-2.
    expect(maxDiff).toBeLessThan(1e-6);
  }, 30_000);
});

describe('renderTrack + encodeAudioBuffer', () => {
  it('exporte une piste decoupee en fichier M4A lisible', async () => {
    const { renderTrack } = await import('@/export/audioMix');
    const { encodeAudioBuffer } = await import('@/features/audio/extractAudio');

    const ctx = new OfflineAudioContext(1, 48000 * 3, 48000);
    const osc = ctx.createOscillator();
    osc.connect(ctx.destination);
    osc.start();
    const source = await ctx.startRendering();

    // Piste de 3 s coupee en deux morceaux: 0-1 s puis 2-3 s.
    const track = {
      id: 'a', kind: 'audio' as const, assetId: 'x', role: 'music' as const,
      start: 0, gain: 1, muted: false, fadeIn: 0, fadeOut: 0,
      source: { in: 0, out: 3 },
      segments: [
        { id: 's1', in: 0, out: 1 },
        { id: 's2', in: 2, out: 3 },
      ],
    };

    const rendered = await renderTrack(track, source);
    expect(rendered).not.toBeNull();
    // Les deux morceaux mis bout a bout: 2 s, et non les 3 s de la source.
    expect(rendered!.duration).toBeCloseTo(2, 1);

    const blob = await encodeAudioBuffer(rendered!);
    expect(blob.type).toBe('audio/mp4');
    expect(blob.size).toBeGreaterThan(1000);

    // Le fichier produit doit etre relisible par le navigateur.
    const check = new OfflineAudioContext(1, 48000, 48000);
    const decoded = await check.decodeAudioData(await blob.arrayBuffer());
    expect(decoded.duration).toBeGreaterThan(1.5);
  }, 30_000);
});
