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
export interface FrameMetrics {
  rafIntervalMs: number | null;
  cpuFrameMs: number;
  cpuSubmitMs: number | null;
  gpuMs: number | null;
  drawCalls: number;
  triangles: number;
  clusters: number | null;
  selectedTriangles: number | null;
  residentPages: number | null;
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
  frustumRejected?: number | null;
  lodLevel?: number | null;
  /** WebGPU transparent submission counters, including both draws for two-pass materials. Null when unavailable. */
  transparentMeshes?: number | null;
  transparentFrustumRejected?: number | null;
  transparentDrawCalls?: number | null;
  transparentSubmittedTriangles?: number | null;
  /** Complete initial GPU fallback is available; null on backends without this guarantee. */
  coverageReady?: boolean | null;
  /** Requested detail cannot coexist with the pinned fallback within the GPU page budget. */
  coverageBudgetLimited?: boolean | null;
  /** Sticky loading error; failed URLs require an explorer reload after three attempts. */
  streamingError?: string | null;
  textureUploaded?: number | null;
  texturePending?: number | null;
  textureSkipped?: number | null;
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
