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

import {
  encodeAudioBuffer,
  extractAudioFromVideo,
  pickAudioExportFormat,
} from '@/features/audio/extractAudio';
import { importFile } from '@/features/import/importMedia';

/**
 * Le navigateur sait-il encoder de l'AAC ?
 *
 * Mesure: le Chromium de l'integration continue REFUSE `mp4a.40.2` — les builds
 * open source n'embarquent pas les codecs proprietaires, contrairement au
 * Chrome installe sur un poste. Les tests qui en dependent sont donc sautes
 * plutot que de faire echouer la CI pour une capacite absente.
 */
async function aacAvailable(): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    const s = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 1, bitrate: 192_000,
    });
    return s.supported === true;
  } catch {
    return false;
  }
}

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
  it('recopie la piste AAC sans la reencoder', async ({ skip }) => {
    // Sans encodeur AAC, impossible de FABRIQUER la fixture: le test n'a plus
    // d'objet. La recopie elle-meme ne depend d'aucun encodeur.
    skip(!(await aacAvailable()), 'AAC non encodable par ce navigateur');

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

    // Le format suit ce que le navigateur sait faire: AAC/MP4 quand il le peut,
    // Opus/WebM sinon. Figer 'audio/mp4' ici cassait la CI.
    const format = await pickAudioExportFormat();

    const blob = await encodeAudioBuffer(rendered!, format);
    expect(blob.type).toBe(format.mimeType);
    expect(blob.size).toBeGreaterThan(1000);

    // Le fichier produit doit etre relisible par le navigateur.
    const check = new OfflineAudioContext(1, 48000, 48000);
    const decoded = await check.decodeAudioData(await blob.arrayBuffer());
    expect(decoded.duration).toBeGreaterThan(1.5);
  }, 30_000);
});

describe('repli Opus', () => {
  it('encode en WebM/Opus quand l’AAC est refuse', async () => {
    const ctx = new OfflineAudioContext(1, 48000, 48000);
    const osc = ctx.createOscillator();
    osc.connect(ctx.destination);
    osc.start();
    const buf = await ctx.startRendering();

    // Force le repli, sans dependre de la capacite reelle du navigateur.
    const blob = await encodeAudioBuffer(buf, {
      codec: 'opus', mimeType: 'audio/webm', extension: 'webm',
    });
    expect(blob.type).toBe('audio/webm');
    expect(blob.size).toBeGreaterThan(500);

    // Relisible par le navigateur.
    const check = new OfflineAudioContext(1, 48000, 48000);
    const decoded = await check.decodeAudioData(await blob.arrayBuffer());
    expect(decoded.duration).toBeGreaterThan(0.5);
  }, 30_000);
});

describe('reimport de l’audio extrait', () => {
  it('accepte un MP4 sans piste video comme fichier audio', async ({ skip }) => {
    skip(!(await aacAvailable()), 'AAC non encodable par ce navigateur');

    const { validateFile, sniffFile } = await import('@/features/import/validateFile');

    const video = await makeAacFile();
    const extracted = await extractAudioFromVideo(video);
    const asFile = new File([extracted], 'son.m4a', { type: extracted.type });

    /*
      La marque `ftyp` reste `isom`: mediabunny ne pose pas `M4A ` meme sur une
      sortie purement sonore. Les octets de tete classent donc le fichier en
      video — c'est attendu, et c'est ce qui rendait le rattrapage necessaire.
    */
    const head = new Uint8Array(await asFile.slice(8, 12).arrayBuffer());
    expect(String.fromCharCode(...head)).toBe('isom');
    expect((await sniffFile(asFile))?.kind).toBe('video');

    // Le rattrapage: sans piste video, le fichier est accepte comme audio.
    const result = await validateFile(asFile, { accept: ['audio'] });
    expect(result.ok).toBe(true);
    expect(result.ok && result.kind).toBe('audio');
  }, 30_000);

  it('ne requalifie pas un fichier image en audio', async () => {
    const { validateFile } = await import('@/features/import/validateFile');

    // PNG minimal: le rattrapage ne doit s'appliquer qu'aux conteneurs video.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const file = new File([png], 'i.png', { type: 'image/png' });

    const result = await validateFile(file, { accept: ['audio'] });
    expect(result.ok).toBe(false);
  });
});

/** Vrai MP4: image ET son, comme un fichier venant d'un telephone. */
async function makeRealVideo(): Promise<File> {
  const { CanvasSource, AudioBufferSource, Output, BufferTarget, Mp4OutputFormat } =
    await import('mediabunny');

  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d')!;

  const out = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 500_000 });
  const audio = new AudioBufferSource({ codec: 'aac', bitrate: 128_000 });
  out.addVideoTrack(video);
  out.addAudioTrack(audio);
  await out.start();

  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 ? '#fff' : '#000';
    ctx.fillRect(0, 0, 320, 240);
    await video.add(i / 10, 1 / 10);
  }
  video.close();

  const ac = new OfflineAudioContext(1, 48_000, 48_000);
  const osc = ac.createOscillator();
  osc.connect(ac.destination);
  osc.start();
  await audio.add(await ac.startRendering());
  audio.close();
  await out.finalize();

  return new File([out.target.buffer!], 'clip.mp4', { type: 'video/mp4' });
}

describe('parcours complet du studio', () => {
  it('extrait le son d’une vraie video et le reimporte comme audio', async ({ skip }) => {
    // La fixture a besoin d'un encodeur AAC, absent des Chromium open source.
    skip(!(await aacAvailable()), 'AAC non encodable par ce navigateur');

    const video = await makeRealVideo();

    const extracted = await extractAudioFromVideo(video);
    const asFile = new File([extracted], 'clip.m4a', { type: extracted.type });

    // C'est l'etape qui echouait: « Ce format de fichier n'est pas pris en
    // charge », juste apres une extraction pourtant reussie.
    const { asset } = await importFile(asFile, { accept: ['audio'] });

    expect(asset.kind).toBe('audio');
    expect(asset.duration).toBeGreaterThan(0.5);
  }, 60_000);
});

describe('simulation CI', () => {
  it('les tests AAC se sautent quand l’encodeur manque', async ({ skip }) => {
    // Neutralise l'encodeur AAC comme sur un Chromium open source.
    const vrai = AudioEncoder.isConfigSupported;
    (AudioEncoder as unknown as { isConfigSupported: unknown }).isConfigSupported = async (
      c: AudioEncoderConfig,
    ) => (c.codec === 'mp4a.40.2' ? { supported: false, config: c } : vrai.call(AudioEncoder, c));

    try {
      const { pickAudioExportFormat, encodeAudioBuffer } = await import(
        '@/features/audio/extractAudio'
      );
      const format = await pickAudioExportFormat();
      // Sans AAC, le repli doit etre Opus/WebM.
      expect(format.codec).toBe('opus');
      expect(format.extension).toBe('webm');

      const ac = new OfflineAudioContext(1, 48000, 48000);
      const osc = ac.createOscillator();
      osc.connect(ac.destination);
      osc.start();
      const blob = await encodeAudioBuffer(await ac.startRendering(), format);
      expect(blob.type).toBe('audio/webm');
    } finally {
      (AudioEncoder as unknown as { isConfigSupported: unknown }).isConfigSupported = vrai;
    }
    void skip;
  }, 30_000);
});
