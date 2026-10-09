import type { MathPathMetrics } from '../runtime/path/contracts.ts'
import type { TextureFrameMetrics } from '../texture/metricsContracts.ts'
import type { ShadowFrameMetrics } from './shadowMetrics.ts'
import type { OcclusionFrameMetrics } from './occlusionMetrics.ts'
import type { GpuMemoryFrameMetrics } from './gpuMemory.ts'
export type { ShadowFrameMetrics } from './shadowMetrics.ts'
export type { OcclusionFrameMetrics } from './occlusionMetrics.ts'
export type { TextureFrameMetrics } from '../texture/metricsContracts.ts'
export type { GpuMemoryFrameMetrics } from './gpuMemory.ts'
/** One timed GPU pass. `gpuMs` is null when the device returned no usable pair of timestamps. */
export interface GpuPassTiming {
  /** The pass's name. */ name: string
  /** GPU time of the pass. */ gpuMs: number | null
  /** Its time less what a pass begun earlier covered (WebGPU). */ ownMs?: number
  /** Why it went unmeasured; `unwritten-timestamps`: an empty pass the driver skipped, which wrote none;
   *  `invalid-timestamps`: a pair with a timestamp missing or the end before the beginning. */
  reason?: string
}
/**
 * GPU durations of one image, pass by pass, as the device reported them. `totalMs` sums the listed
 * passes and nothing else: never added to a `cpu*` field, null once a pass is unmeasured or the list
 * truncated. `frame` names the image described, behind the current one: readback never blocks one.
 */
export interface GpuPassTimings {
  /** The image described. */ frame: number
  /** Sum of the passes. */ totalMs: number | null
  /** Each pass. */ passes: GpuPassTiming[]
  /** Whether passes were left out. */ truncated: boolean
  /** Why timing failed. */ error?: string
}
/**
 * GPU duration of one image: the time its per-submission spans cover, each span being the earliest
 * pass beginning to the latest pass end of one command buffer, from the device's own timestamps. A
 * submission is one contiguous GPU execution, so passes the device runs concurrently are inside its
 * span once, and two submissions it overlaps are covered once — unlike `gpuPassMs.totalMs`, a sum of
 * passes, which counts an overlap twice. The host time between two submissions of the same image is
 * NOT in here; `gpuHostGapMs` carries it alone. Only the passes with a valid timestamp pair make the
 * spans: a pass the driver skipped wrote none (`unwritten-timestamps`) and one whose pair cannot be
 * read (`invalid-timestamps`) has none, and neither voids the passes that ran; the second may lie
 * outside the spans, which are then a lower bound (`gpuPassMs.passes` names it). Null when the list
 * was truncated, when no pass of the image has a valid pair, or when no timestamp query exists.
 */
export type GpuFrameMs = number | null
/** What one frame cost and held: times, triangles, pages, memory. */ export interface FrameMetrics
  extends ShadowFrameMetrics, OcclusionFrameMetrics, TextureFrameMetrics, GpuMemoryFrameMetrics {
  /** Time between two frames, ms: from the rAF timestamp of the frame drawn before this one to its
   *  own, frames held for the readbacks spanned, so a whole number of `displayRefreshMs` on a
   *  display that keeps its grid. Null before two frames and after a pause. */
  rafIntervalMs: number | null
  /** The display's refresh interval, ms, as the engine measured it on its frames' rAF timestamps
   *  (the render-scale budget's clock); null until it found one. */
  displayRefreshMs?: number | null
  /** Width in pixels the image was drawn at, before temporal antialiasing or the resample rebuilt
   *  it to the display: the display's own at a render scale of 1. Null before an image. */
  renderWidth?: number | null
  /** Height in pixels the image was drawn at, beside `renderWidth`. */
  renderHeight?: number | null
  /** CPU time of the frame. */ cpuFrameMs: number
  /** CPU time to send the work. */ cpuSubmitMs: number | null
  /** Draw calls of this frame, as the engine counted them. `null` when it has not counted
   *  them: a zero would read as a frame with no draw. */
  drawCalls: number | null
  /** Triangles submitted to this frame's draw, as `totalSubmittedTriangles` counts them.
   *  `null` when the engine has not counted them: a zero would read as an empty frame. */
  triangles: number | null
  /** Clusters drawn. */ clusters: number | null
  /** Triangles the cut selected. */ selectedTriangles: number | null
  /** Pages held in memory. */ residentPages: number | null
  /** Submitted triangles: on the WebGPU-by-pages path, every drawable row — occlusion
   *  rejects after submit —, held by the table, hence exact and of this frame. */
  submittedTriangles?: number | null
  /** All submitted triangles, including transparent passes. Null while the image is pending. */
  totalSubmittedTriangles?: number | null
  /** Clusters that left the drawn cut this session. A moving camera detaches clusters every frame;
   *  this is not a cache pressure signal. Null while the engine does not count it. */
  pagesDetached?: number | null
  /** Pages actually evicted from the cache that feeds the drawn geometry: the backend's own GPU page
   *  cache when it owns one, the host page streamer otherwise. This is the cache pressure signal. */
  cacheEvictions?: number | null
  /** Bytes of geometry memory. */ geometryAllocationBytes: number | null
  /** Vertex bytes of dynamic geometry uploaded in place this frame, within the world's
   *  per-frame budget (`DYNAMIC_UPLOAD_BUDGET_BYTES`). Absent where no world draws. */
  dynamicUploadBytes?: number
  /** Bytes of GPU memory. */ vramBytes: number | null
  /** Pages loaded so far. */ pageLoads: number
  /** Page bytes read so far. */ pageBytesRead: number
  /** Pages asked for. */ pagesRequested?: number | null
  /** Pages on their way. */ pagesLoading?: number | null
  /** Page reads served from cache. */ cacheHits?: number | null
  /** Page reads that missed the cache. */ cacheMisses?: number | null
  /**
   * What the cut discarded without keeping. On the GPU DAG cut, which walks the
   * culling hierarchy level by level, these are the nodes discarded by the descent — outside the
   * frustum, or whose replacement error ceiling already falls under the threshold — plus the
   * candidate pages that a per-page test then discards. A discarded node counts as one, whatever the
   * number of pages of its subtree: those pages are never visited, hence never counted.
   */
  frustumRejected?: number | null
  /** Detail level of the cut. */ lodLevel?: number | null
  /**
   * The factor the GPU cut's projected-error threshold is cut under: 1, but when the view asks more
   * than the list one GPU binding holds, where the cut stops at coarser levels until its list fits,
   * and comes back to 1 once the view asks less. Null without a GPU cut.
   */
  cutCoarsening?: number | null
  /**
   * WebGPU transparent counters. `transparentDrawCalls` counts every draw, both halves of a two-pass
   * material included; `transparentSubmittedTriangles` counts the triangles of the transparent cut
   * once each, whatever the number of passes that rasterise them — the per-pass multiplication is
   * the GPU's own, since the instance counts are written by the compaction and never read back.
   * Null when unavailable.
   */
  transparentMeshes?: number | null
  /** See-through clusters outside the view. */ transparentFrustumRejected?: number | null
  /** See-through draw calls. */ transparentDrawCalls?: number | null
  /** See-through triangles sent. */ transparentSubmittedTriangles?: number | null
  /** The coarse cover the first frame draws is resident whole; null until it is known. */
  coverageReady?: boolean | null
  /** Requested detail needs more pages than the GPU page budget holds: the rest draws coarser. */
  coverageBudgetLimited?: boolean | null
  /**
   * True when the frame was held: neither the scene, nor the view, nor the resources moved, no
   * asynchronous work was pending, and no CPU stage ran. The displayed
   * pixels are those of the original frame, bit-exact.
   *
   * What the held frame DID is published as-is, never copied from the last complete render:
   * `drawCalls`, `triangles`, `submittedTriangles` and `totalSubmittedTriangles` count only
   * present, and per-stage CPU and GPU durations are zero when the stage did not
   * run, `null` when nothing timed it.
   *
   * What the held frame SHOWS remains described by the cut it redisplays: `clusters`,
   * `selectedTriangles`, `frustumRejected`, `lodLevel` and `residentPages` are those of the
   * original frame, since it is the same cut.
   * Absent from an engine that does not hold its frames.
   */
  frameHeld?: boolean | null
  /** Sticky loading error; failed URLs require an explorer reload after three attempts. */
  streamingError?: string | null
  /** Latest GPU pass sample of this backend; null when the device exposes no timestamp queries. */
  gpuPassMs?: GpuPassTimings | null
  /** Deformation compute duration for the frame named by gpuPassMs; null until timed or unsupported. */
  gpuDeformationMs?: number | null
  /** GPU duration of the image `gpuPassMs.frame` describes, never added to a `cpu*` field. Sampled
   *  every few images, so a number may be a few images old. Null before the first sample, from a
   *  held image until the next device sample, and without `timestamp-query`. */
  gpuFrameMs?: GpuFrameMs
  /** CPU time the same image spent between two of its own submissions, and zero when it submits once.
   *  It is host time, not GPU time, which is why `gpuFrameMs` excludes it. Null when unmeasured. */
  gpuHostGapMs?: number | null
  /** Device idle before the last sampled image, ms: from the last timestamp of the image before it
   *  to its own first, the gap `gpuHostGapMs` cannot hold (an image that submits once carries none
   *  of it). Null when the image before it, or this one, was not timed whole (a pass left untimed,
   *  or one whose timestamps could not be read; a pass the driver skipped does not count), past a
   *  pause, and without `timestamp-query`. */
  gpuIdleMs?: number | null
  /** Why the GPU device was lost; null while it holds. */ gpuDeviceLost?: string | null
  /** Triangles of clusters the published cut names but the frame cannot draw — no resident page and no
   *  covering ancestor. A real hole in the image: zero is the only healthy value. Null when a backend
   *  cannot tell (it draws the cut it selected, so it never has one). */
  uncoveredTriangles?: number | null
  /**
   * Triangles the CURRENT FRAME hands to the draw: its cluster cut, opaque and transparent of
   * the hierarchy combined. Transparent meshes outside the hierarchy are not in it
   * (`transparentSubmittedTriangles`), and occlusion reject is not subtracted
   * (`hizRejectedTriangles`). Counted at cut adoption: no asynchronous GPU readback is waited for,
   * so it is never `null` for lack of time, unlike `submittedTriangles`.
   */
  drawnTriangles?: number | null
  /** Hierarchy nodes on which this frame's cut posed a test — frustum or
   *  level-of-detail decision. A node already decided and fully visible receives none:
   *  it is traversed, not tested. This is the measure of the real work of a hierarchical cut; a
   *  flat cut tests zero of them and walks every cluster.
   *  Null on an engine that does not choose its cut on the CPU, or that does not count it. */
  cpuSelectNodesTested?: number | null
  /**
   * Page integrity checks. `pagesChecked` counts the fetched pages whose SHA-256 digest was
   * taken (`crypto.subtle`, off the main thread). `pageCheckMs` is the cumulative time from each
   * check's start to its digest: it is never added to a per-frame `cpu*` or `gpu*`. Both are
   * `null` as long as no page has been checked — unmeasured, not zero.
   */
  pagesChecked?: number | null
  /** Time spent checking pages. */ pageCheckMs?: number | null
  /** State of the compute-path governor (`../runtime/path/governor.ts`): current path of each
   *  batch operation, medians of both paths, switches. `null` on a host that has not opened
   *  a batch — unmeasured, not "JavaScript path". */
  mathBatch?: MathPathMetrics | null
  /**
   * Off-main-thread page integration. `pagesPlannedOffThread` counts arrivals whose
   * plan — each cluster's place in the pack and the page ranks it moves — was
   * computed by a worker, never those the fallback planned on the main thread.
   * `pagePlanMs` is the cumulative time of those plans, measured by the executor itself, whichever
   * the thread: it is never added to a per-frame `cpu*` or `gpu*`. Both are `null`
   * as long as no arrival has been planned — unmeasured, not zero.
   */
  pagesPlannedOffThread?: number | null
  /** Time spent planning arrivals. */ pagePlanMs?: number | null
}
/** What the engine withholds now, by name: a capability the device, a setting or a program still
 *  compiling keeps from the image (`'temporal antialiasing'`, …); it leaves the list once served. */
export interface EngineCapabilities {
  /** The capabilities withheld. */ unsupported: string[]
}
