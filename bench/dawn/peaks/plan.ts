// The GPU's peaks, one micro-benchmark per resource a pass spends: memory read, written and
// copied, texels loaded and filtered, arithmetic, workgroup memory, pixels written by the raster,
// fragments shaded, triangles set up, and a pass's fixed cost. Each benchmark is sized to run a
// millisecond or more on a desktop GPU, so its two timestamps weigh nothing, and states the work
// one run does in its unit: a rate is that work over the run's time. Pure: the kernels are
// `wgsl.ts`, their resources and passes `encode.ts`.

/** What a benchmark measures, and the unit its rate is given in. */
export type Resource =
  | 'read'
  | 'write'
  | 'copy'
  | 'textureStream'
  | 'texelLoad'
  | 'texelFilter'
  | 'alu'
  | 'shared'
  | 'fill'
  | 'fillMrt4'
  | 'fragments'
  | 'triangles'
  | 'computePass'
  | 'dependentDispatch'
  | 'renderPass'

export type PeakBench = {
  resource: Resource
  /** What the rate is: `GB/s`, `Gtexel/s`, `TFLOP/s`, `Gpixel/s`, `Gtriangle/s`, `ms`. */
  unit: string
  /** The unit's size in the work's own units: 1e9 bytes a GB, 1e12 operations a TFLOP. */
  per: number
  /** The work one run does, in the work's own units (bytes, texels, flops, pixels, triangles). */
  work: number
  /** The run's shape, read by `wgsl.ts` and `encode.ts`. */
  size: Record<string, number>
}

/** A buffer the memory benchmarks stream: 256 MiB, past every cache of the machine. */
export const STREAM_BYTES = 256 * 2 ** 20
const VEC4 = 16
/** vec4f elements each streaming thread reads or writes, `threads` apart (coalesced). */
const PER_THREAD = 4
const streamThreads = STREAM_BYTES / VEC4 / PER_THREAD
/** The streamed texture: 4096², rgba16float, 128 MiB. */
const STREAM_SIDE = 4096
/** The cached texture: 256², rgba16float, 512 KiB, read by a 2048² grid of threads. */
const CACHED_SIDE = 256
const GRID = 2048
const TAPS = 16
/** Arithmetic: 2 vec4f accumulators (8 independent chains) a thread, 256 fused multiply-adds each. */
const ALU_THREADS = 2 ** 22
const ALU_ITERATIONS = 256
const ALU_LANES = 8
/** Workgroup memory: a 256-thread group's 256 vec4f, each thread reading 256 of them. */
const SHARED_THREADS = 2 ** 22
const SHARED_READS = 256
/** The raster's target: 4096², rgba16float (8 bytes a pixel). */
const TARGET = 4096
const OVERDRAW = 8
/** Triangles: one a pixel of a 2048² target, each covering its pixel's centre. */
const TRIANGLE_SIDE = 2048
/** Dispatches of one pass each reading what the one before wrote: the GPU drains between them. */
const DEPENDENT_DISPATCHES = 32
/** A pass's fixed cost: an empty dispatch, and a render pass loading and storing one target the
 *  size of the bench's drawn image (2056 × 1144, rgba16float) without a draw. */
const PASS_TARGET = [2056, 1144]

/** Every benchmark, in the order they run. */
export function peakPlan(): PeakBench[] {
  const gb = 1e9,
    g = 1e9
  return [
    { resource: 'read', unit: 'GB/s', per: gb, work: STREAM_BYTES, size: stream() },
    { resource: 'write', unit: 'GB/s', per: gb, work: STREAM_BYTES, size: stream() },
    { resource: 'copy', unit: 'GB/s', per: gb, work: 2 * STREAM_BYTES, size: stream() },
    {
      resource: 'textureStream',
      unit: 'GB/s',
      per: gb,
      work: STREAM_SIDE * STREAM_SIDE * 8,
      size: { side: STREAM_SIDE },
    },
    {
      resource: 'texelLoad',
      unit: 'Gtexel/s',
      per: g,
      work: GRID * GRID * TAPS,
      size: { side: CACHED_SIDE, grid: GRID, taps: TAPS },
    },
    {
      resource: 'texelFilter',
      unit: 'Gtexel/s',
      per: g,
      work: GRID * GRID * TAPS,
      size: { side: CACHED_SIDE, grid: GRID, taps: TAPS },
    },
    {
      resource: 'alu',
      unit: 'TFLOP/s',
      per: 1e12,
      // A fused multiply-add is two operations.
      work: 2 * ALU_THREADS * ALU_ITERATIONS * ALU_LANES,
      size: { threads: ALU_THREADS, iterations: ALU_ITERATIONS },
    },
    {
      resource: 'shared',
      unit: 'GB/s',
      per: gb,
      work: SHARED_THREADS * SHARED_READS * VEC4,
      size: { threads: SHARED_THREADS, reads: SHARED_READS },
    },
    { resource: 'fill', unit: 'Gpixel/s', per: g, work: TARGET ** 2, size: raster(1, 1) },
    { resource: 'fillMrt4', unit: 'Gpixel/s', per: g, work: TARGET ** 2, size: raster(4, 1) },
    {
      resource: 'fragments',
      unit: 'Gpixel/s',
      per: g,
      work: OVERDRAW * TARGET ** 2,
      size: raster(1, OVERDRAW),
    },
    {
      resource: 'triangles',
      unit: 'Gtriangle/s',
      per: g,
      work: TRIANGLE_SIDE ** 2,
      size: { side: TRIANGLE_SIDE },
    },
    { resource: 'computePass', unit: 'ms', per: 0, work: 1, size: {} },
    {
      resource: 'dependentDispatch',
      unit: 'ms',
      per: 0,
      work: DEPENDENT_DISPATCHES,
      size: { dispatches: DEPENDENT_DISPATCHES },
    },
    {
      resource: 'renderPass',
      unit: 'ms',
      per: 0,
      work: 1,
      size: { width: PASS_TARGET[0], height: PASS_TARGET[1] },
    },
  ]
}

function stream() {
  return { threads: streamThreads, perThread: PER_THREAD, bytes: STREAM_BYTES }
}

function raster(attachments: number, layers: number) {
  return { side: TARGET, attachments, layers }
}

/** A run's rate in its unit, from its time in ms; a fixed cost (`per` 0) is its time over the
 *  times it was paid. */
export const rateOf = (bench: PeakBench, ms: number) =>
  bench.per ? bench.work / (ms / 1000) / bench.per : ms / bench.work
