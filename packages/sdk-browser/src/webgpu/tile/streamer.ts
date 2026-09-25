import type { TextureLevelReader } from '../../texture/levelReader.ts';
import type { AtlasLanes, PoolEncoding } from '../../texture/blockFormats.ts';
import { createWebgpuTileAtlas, type TileTexture } from './atlas.ts';
import { createFrameBudget } from '../../page/integration/frameBudget.ts';
import { createWebgpuTileFeedback } from './feedback.ts';
import { createTileSources } from './sources.ts';
import { createWebgpuTileReduce } from './reduce.ts';
import { createTileCounters } from './counters.ts';
import { createTileRequests } from './requests.ts';
import { HEADERS_SWITCHED, HEADERS_WRITTEN, samplingHeaders } from './samplingHeaders.ts';

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
  /** Layers of each lane's pool, per atlas. */
  layers: AtlasLanes;
  /** The encoding the lanes take: their formats, their texel cost, their level file. */
  encoding: PoolEncoding;
  /** Tile bytes admitted per image outside a barrier. */
  budgetBytes: number;
  /** Milliseconds a pass may spend copying tiles outside a barrier; the rest is deferred. */
  budgetMs: number;
  /** Clock the budget is read on; `performance.now` unless a test drives it. */
  now?: () => number;
  readLevel?: TextureLevelReader;
  onFailure: (phase: string, error: unknown) => void;
  /** Colour textures a tile of which arrived or was evicted in this pump, or whose sampling moved
   *  — what a cutout-foliage shadow must follow; empty when only a data texture's did —, or `-1`
   *  when the pool was resized. */
  onColorChanged: (slots: ReadonlySet<number> | -1) => void;
}) {
  const { device, encoding } = options,
    now = options.now ?? (() => performance.now()),
    budget = createFrameBudget(options.budgetMs, now);
  /** Colour textures a pump served or evicted a tile of: named once each, however many tiles. */
  const colorChanged = new Set<number>();
  const color = createWebgpuTileAtlas(device, {
    kind: 'color',
    encoding,
    layers: options.layers.color,
    feedbackOffset: 0,
    textures: options.color,
    onEvicted: (slot) => colorChanged.add(slot),
  });
  const data = createWebgpuTileAtlas(device, {
    kind: 'data',
    encoding,
    layers: options.layers.data,
    feedbackOffset: color.pages.entries,
    textures: options.data,
  });
  const feedback = createWebgpuTileFeedback(device, color.pages.entries + data.pages.entries);
  const reduce = createWebgpuTileReduce(device);
  const counters = createTileCounters();
  const sources = createTileSources({
    device,
    readLevel: options.readLevel,
    encoding,
    counters,
    onFailure: options.onFailure,
  });
  const requests = createTileRequests({ feedback, color, data, counters });
  const atlases = [color, data];
  const flushAll = () => atlases.forEach((atlas) => atlas.flush(device));
  const followHeaders = samplingHeaders(color, data);
  return {
    color,
    data,
    feedback,
    counters,
    sources,
    /** Pins every queue: what the image shows before any tile is requested. */
    prepare() {
      for (const atlas of atlases)
        atlas.pinTails(device.queue, (slot, place) => sources.tail(atlas, slot, place));
      followHeaders(true);
      flushAll();
    },
    /**
     * One pass: requested tiles, served in weight order until the byte or the millisecond budget
     * (`FrameBudget`) is spent; `unbounded` lifts both. Both are read after each copy: the first
     * always lands, the one that crosses a budget overshoots it — the peak says by how much. Returns
     * what was served and what is pending — waiting for its bytes, or deferred to the next pass; a
     * pool refusal is neither — nothing will come, the coarse level holds — and is counted.
     */
    pump(frame: number, unbounded = false) {
      const started = now();
      budget.open();
      let served = 0,
        waiting = 0,
        bytes = 0,
        index = 0,
        stop = false,
        encoder: GPUCommandEncoder | undefined;
      colorChanged.clear();
      const open = () =>
        (encoder ??= device.createCommandEncoder({ label: 'Trillion3D texture tiles' }));
      const wanted = requests.take(frame),
        at = requests.frame;
      counters.worked = wanted.length > 0;
      for (; index < wanted.length && !stop; index++) {
        const request = wanted[index];
        let verdict: ReturnType<typeof sources.serve> = 'waiting';
        try {
          verdict = sources.serve(request.atlas, request.key, at, open);
        } catch (error) {
          options.onFailure('texture-tile-failed', error);
        }
        if (verdict === 'waiting') waiting++;
        else if (verdict === 'served') {
          served++;
          bytes += request.atlas.poolOf(request.key.slot).tileBytes;
          if (request.atlas === color) colorChanged.add(request.key.slot);
          budget.spend();
          stop = !unbounded && (bytes >= options.budgetBytes || !budget.admits());
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
      // The shadows that follow the landed tiles are the pass's cost too: timed before the clock stops.
      if (colorChanged.size) options.onColorChanged(colorChanged);
      counters.pass(now() - started, unbounded);
      return { served, pending: counters.pending };
    },
    /** Follows the atlases' records, writes the headers that moved and copies a moved host picture
     *  again (#362), signalled as a landed tile is (#360, #361). True when a filter rule switched
     *  on or off: the rows that wear it change resolve class. */
    followSampling() {
      colorChanged.clear();
      const found = followHeaders(false, colorChanged, sources.refresh);
      if (!(found & HEADERS_WRITTEN)) return false;
      flushAll();
      options.onColorChanged(colorChanged);
      return (found & HEADERS_SWITCHED) !== 0;
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
    /** Lane pools whose layers change are replaced, tiles kept; returns the evicted tiles. */
    resize(layers: AtlasLanes) {
      const results = [color.resize(device, layers.color), data.resize(device, layers.data)];
      if (results.some((result) => result.replaced)) {
        flushAll();
        options.onColorChanged(-1);
      }
      return results.reduce((total, result) => total + result.evicted, 0);
    },
    metrics: () => counters.metrics(atlases, sources, encoding.name),
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
