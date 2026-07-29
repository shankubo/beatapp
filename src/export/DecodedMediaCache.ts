/**
 * Cache de frames pour l'export: decodage EXACT via mediabunny.
 *
 * L'apercu utilise des `<video>`, qui donnent "a peu pres la bonne frame".
 * Ici on decode explicitement la frame demandee, ce qui rend l'export
 * reproductible: deux exports du meme projet donnent les memes images.
 *
 * Le decodage etant asynchrone alors que `MediaCache.frameAt` est synchrone
 * (le compositeur ne peut pas attendre), on prepare les frames a l'avance avec
 * `prepare(time)`, appele juste avant chaque `buildScene`.
 */

import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample } from 'mediabunny';

import type { FrameSource, MediaCache } from '../engine/MediaCache';
import { clipIndexAt, sourceTimeAt } from '../domain/timeline';
import type { Id, Project, Seconds } from '../domain/types';
import { needsOutgoingFrame } from '../engine/transitions';
import { effectiveTransition } from '../domain/timeline';

interface VideoEntry {
  sink: VideoSampleSink;
  /** Frame actuellement decodee, prete pour `frameAt`. */
  current: VideoSample | null;
}

export class DecodedMediaCache implements MediaCache {
  private readonly images = new Map<Id, ImageBitmap>();
  private readonly videos = new Map<Id, VideoEntry>();
  private readonly inputs: Input[] = [];

  private constructor(private readonly project: Project) {}

  /**
   * Prepare le cache pour un projet: decode les images et ouvre les videos.
   * `blobs` doit fournir un blob pour chaque media reference par le montage.
   */
  static async create(
    project: Project,
    blobs: ReadonlyMap<Id, Blob>,
  ): Promise<DecodedMediaCache> {
    const cache = new DecodedMediaCache(project);

    for (const clip of project.videoTrack.clips) {
      const asset = project.assets[clip.assetId];
      const blob = blobs.get(clip.assetId);
      if (!asset || !blob) continue;

      if (asset.kind === 'image') {
        if (!cache.images.has(asset.id)) {
          cache.images.set(asset.id, await createImageBitmap(blob));
        }
        continue;
      }

      if (asset.kind === 'video' && !cache.videos.has(asset.id)) {
        const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
        cache.inputs.push(input);

        const track = await input.getPrimaryVideoTrack();
        if (!track) continue;

        cache.videos.set(asset.id, { sink: new VideoSampleSink(track), current: null });
      }
    }

    return cache;
  }

  /**
   * Decode les frames necessaires a l'instant `time`.
   * A appeler AVANT `buildScene`, car `frameAt` est synchrone.
   */
  async prepare(time: Seconds): Promise<void> {
    const { videoTrack } = this.project;
    const index = clipIndexAt(videoTrack, time);
    if (index < 0) return;

    const clip = videoTrack.clips[index]!;
    await this.decodeFor(clip.assetId, sourceTimeAt(clip, time));

    // Pendant une transition, le clip precedent est aussi visible: sans cela,
    // il apparaitrait noir pendant tout le fondu.
    const transition = effectiveTransition(videoTrack.clips, index);
    if (
      transition &&
      needsOutgoingFrame(transition.type) &&
      time < clip.start + transition.duration &&
      index > 0
    ) {
      const previous = videoTrack.clips[index - 1]!;
      await this.decodeFor(previous.assetId, sourceTimeAt(previous, previous.start + previous.duration));
    }
  }

  private async decodeFor(assetId: Id, sourceTime: Seconds): Promise<void> {
    const entry = this.videos.get(assetId);
    if (!entry) return;

    const sample = await entry.sink.getSample(sourceTime);
    if (sample) {
      // On libere la frame precedente: les `VideoSample` detiennent de la
      // memoire GPU, et ne pas les fermer epuise le decodeur en quelques
      // secondes d'encodage.
      entry.current?.close();
      entry.current = sample;
    }
  }

  frameAt(assetId: Id, _sourceTime: Seconds): FrameSource | null {
    const bitmap = this.images.get(assetId);
    if (bitmap) {
      return { image: bitmap, width: bitmap.width, height: bitmap.height };
    }

    const entry = this.videos.get(assetId);
    const sample = entry?.current;
    if (!sample) return null;

    // `toCanvasImageSource()` expose le sample sous une forme dessinable.
    return {
      image: sample.toCanvasImageSource(),
      width: sample.displayWidth,
      height: sample.displayHeight,
    };
  }

  dispose(): void {
    for (const bitmap of this.images.values()) bitmap.close();
    this.images.clear();

    for (const entry of this.videos.values()) entry.current?.close();
    this.videos.clear();

    this.inputs.length = 0;
  }
}
