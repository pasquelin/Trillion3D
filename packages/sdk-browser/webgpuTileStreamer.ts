import { TILE_BYTES } from './textureTiles.ts';
import type { TextureLevelReader } from './textureLevelReader.ts';
import { createWebgpuTileAtlas, type TileTexture } from './webgpuTileAtlas.ts';
import { createWebgpuTileFeedback } from './webgpuTileFeedback.ts';
import { createTileSources } from './webgpuTileSources.ts';
import { createWebgpuTileReduce } from './webgpuTileReduce.ts';
import { createTileCounters } from './webgpuTileCounters.ts';
import { createTileRequests } from './webgpuTileRequests.ts';

/**
 * Tile streamer: what the image asked becomes resident, under a per-image budget in bytes AND in
 * milliseconds, most looked-at tile first. Image-feedback counters name the tiles; the streamer
 * touches those that reside, reads the cooked levels of the others and copies them as soon as
 * their bytes are there, yielding the least looked-at slots when the pool is full.
 *
 * Both budgets are fixed by the host, never read off the machine. The millisecond one is what
 * keeps a cold traversal from stalling the frame: a pass stops copying once it has spent it, the
 * remainder is deferred to the next pass — shown meanwhile by its finest resident ancestor level —
 * and the worst pass of the session is published (`textureUploadPeakMs`), since a stutter is a
 * peak, never a median.
 *
 * Nothing waits here: a tile whose level is still being read will come back on the next feedback.
 * Only the barrier (`flush`) asks for convergence — every pixel speaks, the budgets are lifted, and
 * the loop replays until no requested tile is missing.
 */
export function createWebgpuTileStreamer(options: {
  device: GPUDevice;
  color: TileTexture[];
  data: TileTexture[];
  layersPerAtlas: number;
  /** Tile bytes admitted per image outside a barrier. */
  budgetBytes: number;
  /** Milliseconds a pass may spend copying tiles outside a barrier; the rest is deferred. */
  budgetMs: number;
  /** Clock the budget is read on; `performance.now` unless a test drives it. */
  now?: () => number;
  readLevel?: TextureLevelReader;
  onFailure: (phase: string, error: unknown) => void;
  /** Colour tiles have just arrived or left: what a cutout-foliage shadow must follow. */
  onColorChanged: () => void;
}) {
  const { device } = options,
    now = options.now ?? (() => performance.now());
  const color = createWebgpuTileAtlas(device, {
    kind: 'color',
    format: 'rgba8unorm-srgb',
    layers: options.layersPerAtlas,
    feedbackOffset: 0,
    textures: options.color,
  });
  const data = createWebgpuTileAtlas(device, {
    kind: 'data',
    format: 'rgba8unorm',
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
    counters,
    onFailure: options.onFailure,
  });
  const requests = createTileRequests({ feedback, color, data, counters });
  const flushAll = () => {
    color.flush(device);
    data.flush(device);
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
     * One pass: requested tiles, served in weight order until the byte or the millisecond budget is
     * spent; `unbounded` lifts both. The first tile of a pass is always attempted, so a budget under
     * one copy still makes progress. Returns what was served and what still waits — for its bytes,
     * or for the next pass; a pool refusal is neither — nothing will come, the coarse level holds,
     * and the image can settle on it — and is counted in the atlas metrics.
     */
    pump(frame: number, unbounded = false) {
      const started = now();
      let served = 0,
        waiting = 0,
        bytes = 0,
        index = 0,
        colorServed = false,
        encoder: GPUCommandEncoder | undefined;
      const open = () => (encoder ??= device.createCommandEncoder({ label: 'WG texture tiles' }));
      const wanted = requests.take(frame);
      counters.worked = wanted.length > 0;
      const spent = () =>
        !unbounded &&
        served > 0 &&
        (bytes >= options.budgetBytes || now() - started >= options.budgetMs);
      for (; index < wanted.length && !spent(); index++) {
        const request = wanted[index];
        let verdict: ReturnType<typeof sources.serve> = 'waiting';
        try {
          verdict = sources.serve(request.atlas, request.key, frame, open);
        } catch (error) {
          options.onFailure('texture-tile-failed', error);
        }
        if (verdict === 'waiting') waiting++;
        else if (verdict === 'served') {
          served++;
          bytes += TILE_BYTES;
          if (request.atlas === color) colorServed = true;
        }
      }
      if (encoder) device.queue.submit([encoder.finish()]);
      sources.endPass();
      flushAll();
      requests.defer(wanted, index);
      counters.served += served;
      counters.deferred = requests.deferred;
      counters.pending = waiting + requests.deferred;
      counters.bytesLastFrame = bytes;
      counters.pass(now() - started, unbounded);
      if (colorServed) options.onColorChanged();
      return { served, waiting: counters.pending };
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
