/** A summary of how smoothly the engine ran lately, and what slowed it. */
export interface TelemetryReport {
  /** When it was made. */
  timestamp: number;
  /** Frames per second. */
  fps: number | null;
  /** Median frame time. */
  p50Ms: number | null;
  /** Frame time 95 frames in 100 stay under. */
  p95Ms: number | null;
  /** Frame time 99 frames in 100 stay under. */
  p99Ms: number | null;
  /** Frames that took far too long. */
  stutters: number | null;
  /** CPU time of a frame. */
  cpuFrameMs: number;
  /** CPU time to send the work. */
  cpuSubmitMs: number | null;
  /** GPU memory, in MB. */
  vramMb: number | null;
  /** Triangle counts. */
  triangles: {
    source: number;
    selected: number | null;
    submitted: number | null;
    cullingRatePercent: number | null;
  };
  /** Cluster counts. */
  clusters: {
    total: number;
    visible: number | null;
    frustumCulled: number | null;
  };
  /** Streaming counts. */
  streaming: {
    residentPages: number | null;
    pageLoads: number;
    pageBytesReadMb: number;
    pagesRequested: number | null;
    pagesLoading: number | null;
    cacheHitRate: number | null;
  };
  /** What limits the frame. */
  bottleneck: 'healthy' | 'cpu_bound' | 'gpu_submit_bound' | 'streaming_bound' | 'memory_pressure';
  /** Why, in words. */
  bottleneckMessage: string;
}
