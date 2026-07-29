import { describe, expect, it } from 'vitest';

import { GENERATED_SAMPLES, encodeWav, renderSample } from '@/features/samples/sampleGen';
import { analyzeBeats } from '@/audio/beatDetection';
import { sniffFile } from '@/features/import/validateFile';

/**
 * `AudioBuffer` minimal pour Node: `createBuffer` n'existe pas hors navigateur,
 * et les generateurs n'ont besoin que de `getChannelData`.
 */
class FakeAudioBuffer {
  private readonly channels: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel]!;
  }
}

const fakeContext = {
  createBuffer: (channels: number, length: number, sampleRate: number) =>
    new FakeAudioBuffer(channels, length, sampleRate) as unknown as AudioBuffer,
} as unknown as BaseAudioContext;

describe('boucles generees', () => {
  it('expose un catalogue non vide, aux identifiants uniques', () => {
    expect(GENERATED_SAMPLES.length).toBeGreaterThan(0);
    const ids = new Set(GENERATED_SAMPLES.map((s) => s.id));
    expect(ids.size).toBe(GENERATED_SAMPLES.length);
  });

  it('utilise des cles i18n completes et jamais de libelle en dur', () => {
    // Les cles portent leur namespace: c'est ce qui les rend verifiables par
    // le compilateur au lieu d'etre assemblees a l'usage.
    for (const sample of GENERATED_SAMPLES) {
      expect(sample.nameKey).toMatch(/^samples:generated\.[a-zA-Z]+\.name$/);
      expect(sample.descriptionKey).toMatch(/^samples:generated\.[a-zA-Z]+\.description$/);
    }
  });

  it('produit un signal audible et non sature', () => {
    for (const sample of GENERATED_SAMPLES) {
      const buffer = sample.build(fakeContext, sample.bpm, sample.bars);
      const data = buffer.getChannelData(0);

      let peak = 0;
      for (const value of data) peak = Math.max(peak, Math.abs(value));

      // Normalise a -3 dBFS: ni silencieux, ni ecrete.
      expect(peak).toBeGreaterThan(0.5);
      expect(peak).toBeLessThanOrEqual(1);
    }
  });

  it('a la duree attendue pour son BPM et son nombre de mesures', () => {
    for (const sample of GENERATED_SAMPLES) {
      const buffer = sample.build(fakeContext, sample.bpm, sample.bars);
      const expected = (60 / sample.bpm) * 4 * sample.bars;
      expect(buffer.duration).toBeCloseTo(expected, 2);
    }
  });

  it('est detecte au BPM exact avec lequel il a ete genere', () => {
    // C'est tout l'interet des boucles generees: la verite est connue, donc on
    // peut verifier la chaine complete generation -> analyse.
    for (const sample of GENERATED_SAMPLES) {
      // Une boucle a tempo libre (accelerando) n'a pas de BPM a detecter.
      if (sample.freeTempo) continue;

      const buffer = renderSample(sample, fakeContext, 16);
      const beatMap = analyzeBeats(
        buffer.getChannelData(0),
        buffer.sampleRate,
        sample.id,
      );

      expect(beatMap.bpm).toBeGreaterThan(sample.bpm - 2);
      expect(beatMap.bpm).toBeLessThan(sample.bpm + 2);
      expect(beatMap.confidence).toBeGreaterThan(0.3);
    }
  });

  it('repete la boucle pour couvrir la duree demandee', () => {
    const sample = GENERATED_SAMPLES[0]!;
    const single = sample.build(fakeContext, sample.bpm, sample.bars);
    const rendered = renderSample(sample, fakeContext, 30);

    expect(rendered.duration).toBeGreaterThanOrEqual(30);
    // La duree doit etre un multiple entier de la boucle: sinon la repetition
    // couperait au milieu d'une mesure.
    const repeats = rendered.length / single.length;
    expect(Number.isInteger(repeats)).toBe(true);
  });

  it('est deterministe: deux generations donnent le meme signal', () => {
    // Un bruit non deterministe rendrait les tests instables et changerait la
    // boucle a chaque ouverture de l'app.
    const sample = GENERATED_SAMPLES[1]!;
    const first = sample.build(fakeContext, sample.bpm, sample.bars).getChannelData(0);
    const second = sample.build(fakeContext, sample.bpm, sample.bars).getChannelData(0);
    expect(Array.from(first.slice(0, 5000))).toEqual(Array.from(second.slice(0, 5000)));
  });
});

describe('encodeWav', () => {
  it('produit un WAV reconnaissable par la validation d import', async () => {
    // La boucle generee doit franchir exactement le meme controle qu'un fichier
    // importe par l'utilisateur: pas de chemin de code special.
    const sample = GENERATED_SAMPLES[0]!;
    const buffer = sample.build(fakeContext, sample.bpm, 1);
    const blob = encodeWav(buffer);

    const file = new File([blob], 'loop.wav', { type: 'audio/wav' });
    const sniffed = await sniffFile(file);
    expect(sniffed).toEqual({ ok: true, kind: 'audio', mimeType: 'audio/wav' });
  });

  it('ecrit un entete de la bonne taille', () => {
    const buffer = new FakeAudioBuffer(1, 1000, 44_100) as unknown as AudioBuffer;
    const blob = encodeWav(buffer);
    // 44 octets d'entete + 1000 echantillons mono sur 16 bits.
    expect(blob.size).toBe(44 + 1000 * 2);
  });
});
