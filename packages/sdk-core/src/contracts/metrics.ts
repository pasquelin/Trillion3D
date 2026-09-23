import type { MathPathMetrics } from '../math/path/contracts.ts';
import type { TextureFrameMetrics } from '../texture/metricsContracts.ts';
import type { ShadowFrameMetrics } from './shadowMetrics.ts';
import type { OcclusionFrameMetrics } from './occlusionMetrics.ts';
import type { GpuMemoryFrameMetrics } from './gpuMemory.ts';
export type { ShadowFrameMetrics } from './shadowMetrics.ts';
export type { OcclusionFrameMetrics } from './occlusionMetrics.ts';
export type { TextureFrameMetrics } from '../texture/metricsContracts.ts';
export type { GpuMemoryFrameMetrics } from './gpuMemory.ts';

/** One timed GPU pass. `gpuMs` is null when the device returned no usable pair of timestamps. */
export interface GpuPassTiming {
  /** The pass's name. */ name: string;
  /** GPU time of the pass. */ gpuMs: number | null;
  /** Why it went unmeasured. */ reason?: string;
}
/**
 * GPU durations of one image, pass by pass, as the device itself reported them. `totalMs` is the sum
 * of the listed passes and nothing else: it is never added to a `cpu*` field, and it is null as soon
 * as one pass is unmeasured or the list was truncated. `frame` names the image the sample describes,
 * which lags the current one because the readback never blocks an image.
 */
export interface GpuPassTimings {
  /** The image described. */ frame: number;
  /** Sum of the passes. */ totalMs: number | null;
  /** Each pass. */ passes: GpuPassTiming[];
  /** Whether passes were left out. */ truncated: boolean;
  /** Why timing failed. */ error?: string;
}
/**
 * GPU duration of one image: the sum of its per-submission spans, each span being the earliest pass
 * beginning to the latest pass end of one command buffer, from the device's own timestamps. A
 * submission is one contiguous GPU execution, so passes the device runs concurrently are inside its
 * span once — unlike `gpuPassMs.totalMs`, a sum of passes, which counts an overlap twice. The host
 * time between two submissions of the same image is NOT in here; `gpuHostGapMs` carries it alone.
 * Null when a pass of the image went unmeasured, the list was truncated, or the device exposes no
 * timestamp query.
 */
export type GpuFrameMs = number | null;
/** What one frame cost and held: times, triangles, pages, memory. */ export interface FrameMetrics
  extends ShadowFrameMetrics, OcclusionFrameMetrics, TextureFrameMetrics, GpuMemoryFrameMetrics {
  /** Time between two frames. */ rafIntervalMs: number | null;
  /** CPU time of the frame. */ cpuFrameMs: number;
  /** CPU time to send the work. */ cpuSubmitMs: number | null;
  /** GPU time of the frame. */ gpuMs: number | null;
  /** Draw calls of this frame, as the engine counted them. `null` when it has not counted
   *  them: a zero would read as a frame with no draw. */
  drawCalls: number | null;
  /** Paged cluster draws issued by the engine-owned WebGL2 program in this session. */
  autonomousClusterDrawsTotal?: number | null;
  /** Scene copies — the transmissive surfaces — the engine-owned WebGL2 program drew this frame. */
  autonomousCopyDraws?: number | null;
  /** Bytes the WebGL2 transmission backdrop holds since the first transmissive copy in view. */
  transmissionBackdropBytes?: number | null;
  /** Triangles submitted to this frame's draw, as `totalSubmittedTriangles` counts them.
   *  `null` when the engine has not counted them: a zero would read as an empty frame. */
  triangles: number | null;
  /** Clusters drawn. */ clusters: number | null;
  /** Triangles the cut selected. */ selectedTriangles: number | null;
  /** Pages held in memory. */ residentPages: number | null;
  /** Submitted triangles: on the WebGPU-by-pages path, every drawable row — occlusion
   *  rejects after submit —, held by the table, hence exact and of this frame. */
  submittedTriangles?: number | null;
  /** All submitted triangles, including transparent passes. Null when a backend cannot count them. */
  totalSubmittedTriangles?: number | null;
  /** Clusters that left the drawn cut this session. A moving camera detaches clusters every frame;
   *  this is not a cache pressure signal. Null on a backend that does not track a cut. */
  pagesDetached?: number | null;
  /** Pages actually evicted from the cache that feeds the drawn geometry: the backend's own GPU page
   *  cache when it owns one, the host page streamer otherwise. This is the cache pressure signal. */
  cacheEvictions?: number | null;
  /** Bytes of geometry memory. */ geometryAllocationBytes: number | null;
  /** Bytes of GPU memory. */ vramBytes: number | null;
  /** Pages loaded so far. */ pageLoads: number;
  /** Page bytes read so far. */ pageBytesRead: number;
  /** Pages asked for. */ pagesRequested?: number | null;
  /** Pages on their way. */ pagesLoading?: number | null;
  /** Page reads served from cache. */ cacheHits?: number | null;
  /** Page reads that missed the cache. */ cacheMisses?: number | null;
  /**
   * What the cut discarded without keeping. On the GPU DAG cut, which walks the
   * culling hierarchy level by level, these are the nodes discarded by the descent — outside the
   * frustum, or whose replacement error ceiling already falls under the threshold — plus the
   * candidate pages that a per-page test then discards. A discarded node counts as one, whatever the
   * number of pages of its subtree: those pages are never visited, hence never counted.
   * The CPU cut, for its part, counts its own tested nodes and its own rejects.
   */
  frustumRejected?: number | null;
  /** Detail level of the cut. */ lodLevel?: number | null;
  /**
   * WebGPU transparent counters. `transparentDrawCalls` counts every draw, both halves of a two-pass
   * material included; `transparentSubmittedTriangles` counts the triangles of the transparent cut
   * once each, whatever the number of passes that rasterise them — the per-pass multiplication is
   * the GPU's own, since the instance counts are written by the compaction and never read back.
   * Null when unavailable.
   */
  transparentMeshes?: number | null;
  /** See-through clusters outside the view. */ transparentFrustumRejected?: number | null;
  /** See-through draw calls. */ transparentDrawCalls?: number | null;
  /** See-through triangles sent. */ transparentSubmittedTriangles?: number | null;
  /** Complete initial GPU fallback is available; null on backends without this guarantee. */
  coverageReady?: boolean | null;
  /** Requested detail cannot coexist with the pinned fallback within the GPU page budget. */
  coverageBudgetLimited?: boolean | null;
  /** Screen-error floor the GPU page budget imposes on the cut, in pixels: `0` when the requested
   *  detail fits, otherwise the coarser threshold the image is drawn at. Null on engines without a
   *  page budget. */
  budgetPixelError?: number | null;
  /**
   * True when the frame was held: neither the scene, nor the view, nor the resources moved, no
   * asynchronous work was pending, and no CPU stage ran. The displayed
   * pixels are those of the original frame, bit-exact.
   *
   * What the held frame DID is published as-is, never copied from the last complete render:
   * `drawCalls`, `triangles`, `submittedTriangles` and `totalSubmittedTriangles` count only
   * present, and per-stage CPU and GPU durations are zero when the stage did not
   * run, `null` when nothing timed it. An engine whose image is a scene the witness adapter
   * draws counts what that adapter submitted in this frame — nothing, on a held one.
   *
   * What the held frame SHOWS remains described by the cut it redisplays: `clusters`,
   * `selectedTriangles`, `frustumRejected`, `lodLevel` and `residentPages` are those of the
   * original frame, since it is the same cut.
   * Absent from an engine that does not hold its frames.
   */
  frameHeld?: boolean | null;
  /** Sticky loading error; failed URLs require an explorer reload after three attempts. */
  streamingError?: string | null;
  /** Latest GPU pass sample of this backend; null when the device exposes no timestamp queries. */
  gpuPassMs?: GpuPassTimings | null;
  /** GPU duration of the image `gpuPassMs.frame` describes. Never added to a `cpu*` field. */
  gpuFrameMs?: GpuFrameMs;
  /** CPU time the same image spent between two of its own submissions, and zero when it submits once.
   *  It is host time, not GPU time, which is why `gpuFrameMs` excludes it. Null when unmeasured. */
  gpuHostGapMs?: number | null;
  /** Triangles of clusters the published cut names but the frame cannot draw — no resident page and no
   *  covering ancestor. A real hole in the image: zero is the only healthy value. Null when a backend
   *  cannot tell (it draws the cut it selected, so it never has one). */
  uncoveredTriangles?: number | null;
  /**
   * Triangles the CURRENT FRAME hands to the draw: its cluster cut, opaque and transparent of
   * the hierarchy combined, minus the clusters without a resident page that `uncoveredTriangles`
   * counts. Transparent meshes outside the hierarchy are not in it (`transparentSubmittedTriangles`),
   * and occlusion reject is not subtracted (`hizRejectedTriangles`). Counted on the same pass as
   * `uncoveredTriangles`, at cut adoption: no asynchronous GPU readback is
   * waited for, so it is never `null` for lack of time, unlike `submittedTriangles`.
   * Expected coverage relation on this sample: `selected − drawn − uncovered = 0`.
   */
  drawnTriangles?: number | null;
  /** CPU time of this frame's cluster cut, measured around selection alone.
   *  Null on an engine that does not choose its cut on the CPU. */
  cpuSelectMs?: number | null;
  /** True when the engine had a GPU selection and dropped it: what is measured since is the
   *  fallback CPU cut. A fallback also emits the `gpu-selection-fallback` diagnostic, once;
   *  the host copies it as-is, and it is absent from an engine without GPU selection. */
  gpuSelectionFallback?: boolean;
  /** Hierarchy nodes on which this frame's cut posed a test — frustum or
   *  level-of-detail decision. A node already decided and fully visible receives none:
   *  it is traversed, not tested. This is the measure of the real work of a hierarchical cut; a
   *  flat cut tests zero of them and walks every cluster.
   *  Null on an engine that does not choose its cut on the CPU, or that does not count it. */
  cpuSelectNodesTested?: number | null;
  /**
   * Off-main-thread page decode. `pagesDecodedOffThread` counts the tasks — SHA-256 integrity
   * check or per-vertex attribute read — that a worker completed, never
   * those the fallback ran on the main thread. `pageDecodeMs` is the cumulative time of those
   * tasks, measured by the executor itself, whichever the thread: it is decode time, it
   * is never added to a per-frame `cpu*` or `gpu*`. Both are `null` as long as
   * no page has been decoded — unmeasured, not zero.
   */
  pagesDecodedOffThread?: number | null;
  /** Pages whose attributes were read by the WebAssembly-compiled decoder rather than the
   *  JavaScript decoder. Both yield the same bytes; this counter only says which one
   *  ran, hence whether the `.wasm` resource was found and instantiated by this host. */
  pagesDecodedWasm?: number | null;
  /** Time spent decoding pages. */ pageDecodeMs?: number | null;
  /** State of the compute-path governor (`../math/path/governor.ts`): current path of each
   *  batch operation, medians of both paths, switches. `null` on a host that has not opened
   *  a batch — unmeasured, not "JavaScript path". */
  mathBatch?: MathPathMetrics | null;
  /**
   * Off-main-thread page integration. `pagesPlannedOffThread` counts arrivals whose
   * plan — each cluster's place in the pack and the page ranks it moves — was
   * computed by a worker, never those the fallback planned on the main thread.
   * `pagePlanMs` is the cumulative time of those plans, measured by the executor itself, whichever
   * the thread: it is never added to a per-frame `cpu*` or `gpu*`. Both are `null`
   * as long as no arrival has been planned — unmeasured, not zero.
   */
  pagesPlannedOffThread?: number | null;
  /** Time spent planning arrivals. */ pagePlanMs?: number | null;
}
/** What a renderer can do: materials, hierarchy, GPU-driven work. */
export interface BackendCapabilities {
  /** Its name. */ renderer: string;
  /** Which materials it draws. */ materials: string;
  /** Whether it reads the hierarchy. */ hierarchy: boolean;
  /** Whether the GPU picks what to draw. */ gpuDriven: boolean;
  /** Whether it simplifies. */ simplification: boolean;
  /** Whether it evicts pages. */ eviction: boolean;
  /** What it cannot do. */ unsupported: string[];
}
