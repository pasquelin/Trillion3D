/**
 * The frame constants every engine shares: sizes, budgets, batch ceilings. Nothing here builds or
 * reads a host object, so this module names no rendering library — the host-library objects a
 * witness publishes live in the witness library.
 */
import { DEFAULT_STREAMING_MAX_PENDING_PAGES } from '../../../../sdk-core/src/contracts/streamingOptions.ts'
import { STREAMING_PAGE_BYTES } from '../../../../sdk-core/src/contracts/writtenFormats.ts'
/** The ratio a session's drawing buffer was sized at (`devicePixels`): read live, a resize
 *  rewrites it. Unset, the screen's of `view` (the canvas's window) when one is given, else 1:
 *  the one resolver of the ratio. */
export const pixelRatioOf = (
  options: { pixelRatio?: number },
  view?: { devicePixelRatio?: number } | null,
) => options.pixelRatio ?? view?.devicePixelRatio ?? DEFAULT_PIXEL_RATIO

export const DEFAULT_FOV = 55,
  DEFAULT_PIXEL_RATIO = 1,
  DEFAULT_WIDTH = 960,
  DEFAULT_HEIGHT = 540,
  /** Page reads running at once: as many as the streaming may keep pending
   *  (`streamingMaxPendingPages`, `../../geometry/residency/queue.ts`), so the reads are never what
   *  bounds how many streaming pages are on their way. */
  DEFAULT_PAGE_WORKERS = DEFAULT_STREAMING_MAX_PENDING_PAGES,
  /** Bytes the transfer queue holds in flight: the pending streaming pages at their most bytes
   *  each (`STREAMING_PAGE_BYTES`), so the bytes in flight never bound them either
   *  (`../../geometry/streaming/pageStreamer.ts`). */
  DEFAULT_PAGE_TRANSFER_BYTES = DEFAULT_STREAMING_MAX_PENDING_PAGES * STREAMING_PAGE_BYTES,
  /** Root pages the geometry pool's root region opens with, the reference's first allocation,
   *  within the root pages the catalogue has; it grows past them as HLOD cells hold theirs
   *  (`../../frame/prepare/rootCover.ts`, `rootRegionOf`). */
  DEFAULT_INITIAL_ROOT_PAGES = 2048,
  /** Addresses a frame issues at most, taken from the head of the priority-ordered list: the
   *  pages pending at once, a page still lacked keeping its read. */
  PAGE_REQUEST_BATCH = DEFAULT_STREAMING_MAX_PENDING_PAGES,
  /** Cache pages a frame queues at most in the arrival queue, and pages its drain installs at
   *  most: as many as may be pending (`PAGE_REQUEST_BATCH`). Pages alone count, never bytes:
   *  what a page's bytes cost is the frame's clock's to bound (`MAIN_THREAD_FRAME_MS`). */
  ARRIVAL_QUEUE_BATCH = PAGE_REQUEST_BATCH,
  /**
   * The main thread's share of a frame, in milliseconds: ONE CLOCK its streaming stages spend in
   * priority order — the cells and the arrived pages integrated, then the texture tiles
   * (`../../geometry/integration/frameBudget.ts`) —, each stage's first piece always admitted. The programme's 2 ms main-thread frame, widened to the
   * whole frame until the session's first image is shown (`../../frame/loop/firstImage.ts`).
   * Fetching and decoding run in workers and spend none of it; the geometry pool's streaming pages
   * neither, nor the cluster records of the pages they bring: a frame installs a count of streaming
   * pages (`streamingMaxInstallsPerFrame`, `../../geometry/residency/queue.ts`) and writes their
   * records whole (`../../geometry/clusters/clusterResidency.ts`).
   */
  MAIN_THREAD_FRAME_MS = 2
/**
 * Device pixels of a logical dimension, at the ratio the host has set. Canvas creation and
 * resize both compute it: two separate truncations would have ended up with a canvas of one
 * size and a viewport of another.
 */
export const devicePixels = (logical: number, pixelRatio: number | undefined) =>
  Math.floor(logical * (pixelRatio ?? DEFAULT_PIXEL_RATIO))
/** The adapter's own limits the session's device asks for, each up to the ceiling beside it: WebGPU
 *  grants the portable defaults otherwise.
 *  - `Infinity`, all the adapter offers: a virtual shadow page pool slice is one buffer, bound whole
 *    (`maxStorageBufferBindingSize`, `maxBufferSize`: 256 MiB at 4096 pages, 512 MiB at 8192;
 *    `vsmPoolPagesBound`, `../../lighting/shadows/vsm/layoutBytes.ts`), and the water surface stage writes more
 *    colour bytes per sample than the default 32; an adapter below what it needs refuses the pass
 *    by name (`water-pass-refused`), a pool a binding cannot hold is the largest one that fits.
 *  - A count, the most bindings of that kind one stage of the engine's layouts holds: the device
 *    asks no more than it binds, and a layout that outgrows the count fails its unit test
 *    (`gpu/core/stageLimits.test.ts`) before any device sees it. Sampled textures: WebGPU's
 *    guaranteed 16, which every adapter grants; the widest of the lighting's passes, the sun's, binds 9 in its own
 *    group (`sunLayoutEntries`, its targets read by load alone being read-only storage
 *    textures). */
export const WEBGPU_REQUIRED_LIMITS = {
  maxTextureDimension2D: Infinity,
  maxTextureArrayLayers: Infinity,
  maxStorageBufferBindingSize: Infinity,
  maxBufferSize: Infinity,
  maxStorageBuffersPerShaderStage: Infinity,
  // The vertex stage's own count, where the browser has one: the vertex stages that read the colour atlas
  // bind ten in it (`../../gpu/core/vertexTextures.ts`, `grantsVertexTextures`).
  maxStorageBuffersInVertexStage: Infinity,
  maxColorAttachmentBytesPerSample: Infinity,
  // The virtual shadow maps (`../../lighting/shadows/vsm/`): workgroup votes and page lists, mask storage textures.
  maxComputeWorkgroupStorageSize: Infinity,
  maxComputeInvocationsPerWorkgroup: Infinity,
  maxStorageTexturesPerShaderStage: Infinity,
  maxSampledTexturesPerShaderStage: 16,
} as const satisfies Partial<Record<keyof GPUSupportedLimits, number>>
/** The WGSL language features every engine program relies on: the targets read by load alone
 *  (subsurface, lobes, shadow mask table) are read-only storage textures, and the placement tree's
 *  refit and the cut's kernels read and write a record table in place, a read-write one
 *  (`../../geometry/dag/tree/treeRefitWgsl.ts`, `../../geometry/dag/cut/cutTables.ts`).
 *  A browser whose `navigator.gpu.wgslLanguageFeatures` lacks one is refused by name
 *  (`WEBGPU_UNAVAILABLE`). */
export const WEBGPU_REQUIRED_WGSL_FEATURES = ['readonly_and_readwrite_storage_textures'] as const
/**
 * True when the work under `signal` was cancelled: an error then is its cancellation, whatever its
 * name — no failure is diagnosed, nothing falls back. An `AbortError` under a live signal is a
 * failure like any other.
 */
export const isCancelled = (signal: AbortSignal | undefined) => signal?.aborted === true
