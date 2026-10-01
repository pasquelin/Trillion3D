/** S3 candidates are experiments, never measured or approved production tiers. */
type RippleCase = {
  kind: 'ripples';
  backend: 'webgpu' | 'webgl2';
  resolution: 256 | 384 | 512;
  rate: 30 | 15 | 7.5;
  splats: 0 | 64;
};
type SmokeCase = {
  kind: 'smoke';
  backend: 'webgpu';
  grid: 32 | 64;
  iterations: 10 | 20;
  coverage: 0.0625 | 0.25 | 0.5 | 1;
  maxSteps: 128;
};
export type S3Case = RippleCase | SmokeCase;
export type S3Options = {
  case: S3Case;
  enabled: boolean;
  width: number;
  height: number;
  warmup: number;
  frames: number;
};
export type S3Result = {
  options: S3Options;
  status: 'measured' | 'refused';
  refusal: string | null;
  renderer: string | null;
  device: Record<string, unknown> | null;
  capabilities: Record<string, unknown>;
  /** Declared simulation/render resource bytes, not observed VRAM residency; timer resources excluded. */
  bytes: number;
  steps: number;
  splats: number;
  dropped: number;
  droppedSteps: number;
  clampedSeconds: number;
  cpuFrameMs: number[];
  rafIntervalMs: number[];
  /** Earliest-to-latest measured GPU span, never the sum of passes or CPU time. */
  gpuFrameMs: { frame: number; ms: number }[];
  gpuTiming: Record<string, unknown>;
};
