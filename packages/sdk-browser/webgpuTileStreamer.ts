import type { TextureLevelReader } from './textureLevelReader.ts';
import type { PoolEncoding } from './textureBlockFormats.ts';
import {
  createWebgpuTileAtlas,
  type TileTexture,
  type WebgpuTileAtlas,
} from './webgpuTileAtlas.ts';
import { createWebgpuTileFeedback } from './webgpuTileFeedback.ts';
import { createTileSources } from './webgpuTileSources.ts';
import { createWebgpuTileReduce } from './webgpuTileReduce.ts';
import type { TileKey } from './webgpuTilePageTable.ts';
import { createTileCounters } from './webgpuTileCounters.ts';

type Request = { atlas: WebgpuTileAtlas; key: TileKey; weight: number };

/**
 * Tile streamer: what the image asked becomes resident, under a per-image byte budget, most looked-
 * at tile first. Image-feedback counters name the tiles; the streamer touches those that reside,
 * reads the cooked levels of the others and copies them as soon as their bytes are there, yielding
 * the least looked-at slots when the pool is full.
 *
 * Nothing waits here: a tile whose level is still being read will come back on the next feedback.
 * Only the barrier (`flush`) asks for convergence — every pixel speaks, the budget is lifted, and
 * the loop replays until no requested tile is missing.
 */
export function createWebgpuTileStreamer(options: {
  device: GPUDevice;
  color: TileTexture[];
  data: TileTexture[];
  layersPerAtlas: number;
  /** The encoding both pools take: their formats, their texel cost, their level file. */
  encoding: PoolEncoding;
  /** Tile bytes admitted per image outside a barrier. */
  budgetBytes: number;
  readLevel?: TextureLevelReader;
  onFailure: (phase: string, error: unknown) => void;
  /** Colour tiles have just arrived or left: what a cutout-foliage shadow must follow. */
  onColorChanged: () => void;
}) {
  const { device, encoding } = options;
  const color = createWebgpuTileAtlas(device, {
    kind: 'color',
    encoding,
    layers: options.layersPerAtlas,
    feedbackOffset: 0,
    textures: options.color,
  });
  const data = createWebgpuTileAtlas(device, {
    kind: 'data',
    encoding,
    layers: options.layersPerAtlas,
    feedbackOffset: color.pages.entries,
    textures: options.data,
  });
  const feedback = createWebgpuTileFeedback(device, color.pages.entries + data.pages.entries);
  const reduce = createWebgpuTileReduce(device);
  const counters = createTileCounters();
  const sources = createTileSources({
    device,
    readLevel: options.readLevel,
    levelFormat: encoding.levelFormat,
    counters,
    onFailure: options.onFailure,
  });
  const flushAll = () => {
    color.flush(device);
    data.flush(device);
  };
  /** Tiles the last image feedback names, resident ones touched along the way. */
  const requests = (frame: number) => {
    const counts = feedback.take();
    const out: Request[] = [];
    if (!counts) return out;
    let requested = 0,
      atLevel = 0,
      gap = 0;
    for (let index = 0; index < counts.length; index++) {
      const weight = counts[index];
      if (!weight) continue;
      const atlas = index < color.pages.entries ? color : data;
      const key = atlas.pages.tileOf(index);
      requested++;
      const served = atlas.servedLevel(key) - key.level;
      if (served === 0) atLevel++;
      gap += served;
      if (!atlas.touch(key, frame)) out.push({ atlas, key, weight });
    }
    counters.requested = requested;
    counters.atLevel = atLevel;
    counters.missingAverage = requested ? gap / requested : 0;
    return out.sort((a, b) => b.weight - a.weight);
  };
  return {
    color,
    data,
    feedback,
    counters,
    /** Pins every queue: what the image shows before any tile is requested. */
    prepare() {
      for (const atlas of [color, data])
        atlas.pinTails(device.queue, (slot, place) => sources.tail(atlas, slot, place));
      flushAll();
    },
    /**
     * One pass: requested tiles, served in weight order under the byte budget; `unbounded` lifts the
     * budget. Returns what was served and what still waits for its bytes; a pool refusal is neither —
     * nothing will come, the coarse level holds, and the image can settle on it — and is counted in
     * the atlas metrics.
     */
    pump(frame: number, unbounded = false) {
      const started = performance.now();
      let served = 0,
        waiting = 0,
        bytes = 0,
        colorServed = false,
        encoder: GPUCommandEncoder | undefined;
      const open = () => (encoder ??= device.createCommandEncoder({ label: 'WG texture tiles' }));
      const wanted = requests(frame);
      counters.worked = wanted.length > 0;
      for (const request of wanted) {
        if (!unbounded && bytes >= options.budgetBytes) {
          waiting++;
          continue;
        }
        let verdict: ReturnType<typeof sources.serve> = 'waiting';
        try {
          verdict = sources.serve(request.atlas, request.key, frame, open);
        } catch (error) {
          options.onFailure('texture-tile-failed', error);
        }
        if (verdict === 'waiting') waiting++;
        else if (verdict === 'served') {
          served++;
          bytes += color.pool.tileBytes;
          if (request.atlas === color) colorServed = true;
        }
      }
      if (encoder) device.queue.submit([encoder.finish()]);
      sources.endPass();
      flushAll();
      counters.served += served;
      counters.pending = waiting;
      counters.bytesLastFrame = bytes;
      counters.lastMs = performance.now() - started;
      if (colorServed) options.onColorChanged();
      return { served, waiting };
    },
    /** An image's feedback leaves with it: the target where its pixels posted their requests — when a
     *  pass wrote it — is reduced to counters for the phase, copied to their readback then zeroed. */
    publishRequests(
      encoder: GPUCommandEncoder,
      target: GPUTextureView | undefined,
      size: [number, number],
      every: boolean,
    ) {
      if (target) reduce?.encode(encoder, target, feedback.buffer, size, feedback.phaseWord(every));
      feedback.encode(encoder);
    },
    /** False on a device without a compute stage: no pixel asks for a tile. */
    get requestReduce() {
      return reduce !== undefined;
    },
    /** Both pools change layers while keeping their tiles; returns the evicted tiles. */
    resize(layers: number) {
      const evicted = color.resize(device, layers) + data.resize(device, layers);
      flushAll();
      options.onColorChanged();
      return evicted;
    },
    metrics: () => counters.metrics([color, data], sources.levels),
    /** True while a cooked level is being read: a missing tile can still arrive. */
    get reading() {
      return (sources.levels?.inFlight ?? 0) > 0;
    },
    /** Held when in-flight image feedback has come back and level reads have completed. */
    settled: () => Promise.all([feedback.settled(), sources.settled()]).then(() => undefined),
    destroy() {
      sources.destroy();
      reduce?.destroy();
      feedback.destroy();
      color.destroy();
      data.destroy();
    },
  };
}

export type WebgpuTileStreamer = ReturnType<typeof createWebgpuTileStreamer>;
