export interface TelemetryReport {
  timestamp: number;
  fps: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  stutters: number | null;
  cpuFrameMs: number;
  cpuSubmitMs: number | null;
  vramMb: number | null;
  triangles: {
    source: number;
    selected: number | null;
    submitted: number | null;
    cullingRatePercent: number | null;
  };
  clusters: {
    total: number;
    visible: number | null;
    frustumCulled: number | null;
  };
  streaming: {
    residentPages: number | null;
    pageLoads: number;
    pageBytesReadMb: number;
    pagesRequested: number | null;
    pagesLoading: number | null;
    cacheHitRate: number | null;
  };
  bottleneck: 'healthy' | 'cpu_bound' | 'gpu_submit_bound' | 'streaming_bound' | 'memory_pressure';
  bottleneckMessage: string;
}
