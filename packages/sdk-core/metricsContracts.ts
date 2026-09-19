import type { MathPathMetrics } from './mathPathContracts.ts';
import type { TextureFrameMetrics } from './textureMetricsContracts.ts';
import type { ShadowFrameMetrics } from './shadowMetricsContracts.ts';
import type { OcclusionFrameMetrics } from './occlusionMetricsContracts.ts';
import type { GpuMemoryFrameMetrics } from './gpuMemoryContracts.ts';
export type { ShadowFrameMetrics } from './shadowMetricsContracts.ts';
export type { OcclusionFrameMetrics } from './occlusionMetricsContracts.ts';
export type { TextureFrameMetrics } from './textureMetricsContracts.ts';
export type { GpuMemoryFrameMetrics } from './gpuMemoryContracts.ts';

/** One timed GPU pass. `gpuMs` is null when the device returned no usable pair of timestamps. */
export interface GpuPassTiming {
  name: string;
  gpuMs: number | null;
  reason?: string;
}
/**
 * GPU durations of one image, pass by pass, as the device itself reported them. `totalMs` is the sum
 * of the listed passes and nothing else: it is never added to a `cpu*` field, and it is null as soon
 * as one pass is unmeasured or the list was truncated. `frame` names the image the sample describes,
 * which lags the current one because the readback never blocks an image.
 */
export interface GpuPassTimings {
  frame: number;
  totalMs: number | null;
  passes: GpuPassTiming[];
  truncated: boolean;
  error?: string;
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
export interface FrameMetrics
  extends ShadowFrameMetrics, OcclusionFrameMetrics, TextureFrameMetrics, GpuMemoryFrameMetrics {
  rafIntervalMs: number | null;
  cpuFrameMs: number;
  cpuSubmitMs: number | null;
  gpuMs: number | null;
  /** Draw calls of this frame. `null` when neither the engine nor the host renderer
   *  counts them: a zero would read as a frame with no draw. */
  drawCalls: number | null;
  /** Triangles submitted to this frame's draw, as `totalSubmittedTriangles` counts them, or
   *  as the host renderer drew them when it is the one drawing. `null` when neither
   *  has counted: a zero would read as an empty frame. */
  triangles: number | null;
  clusters: number | null;
  selectedTriangles: number | null;
  residentPages: number | null;
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
  geometryAllocationBytes: number | null;
  vramBytes: number | null;
  pageLoads: number;
  pageBytesRead: number;
  pagesRequested?: number | null;
  pagesLoading?: number | null;
  cacheHits?: number | null;
  cacheMisses?: number | null;
  /**
   * What the cut discarded without keeping. On the GPU DAG cut, which walks the
   * culling hierarchy level by level, these are the nodes discarded by the descent — outside the
   * frustum, or whose replacement error ceiling already falls under the threshold — plus the
   * candidate pages that a per-page test then discards. A discarded node counts as one, whatever the
   * number of pages of its subtree: those pages are never visited, hence never counted.
   * The CPU cut, for its part, counts its own tested nodes and its own rejects.
   */
  frustumRejected?: number | null;
  lodLevel?: number | null;
  /**
   * WebGPU transparent counters. `transparentDrawCalls` counts every draw, both halves of a two-pass
   * material included; `transparentSubmittedTriangles` counts the triangles of the transparent cut
   * once each, whatever the number of passes that rasterise them — the per-pass multiplication is
   * the GPU's own, since the instance counts are written by the compaction and never read back.
   * Null when unavailable.
   */
  transparentMeshes?: number | null;
  transparentFrustumRejected?: number | null;
  transparentDrawCalls?: number | null;
  transparentSubmittedTriangles?: number | null;
  /** Complete initial GPU fallback is available; null on backends without this guarantee. */
  coverageReady?: boolean | null;
  /** Requested detail cannot coexist with the pinned fallback within the GPU page budget. */
  coverageBudgetLimited?: boolean | null;
  /**
   * True when the frame was held: neither the scene, nor the view, nor the resources moved, no
   * asynchronous work was pending, and no CPU stage ran. The displayed
   * pixels are those of the original frame, bit-exact.
   *
   * What the held frame DID is published as-is, never copied from the last complete render:
   * `drawCalls`, `triangles`, `submittedTriangles` and `totalSubmittedTriangles` count only
   * present, and per-stage CPU and GPU durations are zero when the stage did not
   * run, `null` when nothing timed it. An engine that does not submit its own frame —
   * the host redrawing the graph it holds — on the other hand counts the calls that host emits.
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
  pageDecodeMs?: number | null;
  /** State of the compute-path governor (`mathPathGovernor.ts`): current path of each
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
  pagePlanMs?: number | null;
}
export interface BackendCapabilities {
  renderer: string;
  materials: string;
  hierarchy: boolean;
  gpuDriven: boolean;
  simplification: boolean;
  eviction: boolean;
  unsupported: string[];
}
