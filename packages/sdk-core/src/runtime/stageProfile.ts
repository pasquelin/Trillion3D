import { summarize } from './stats.ts';

/**
 * Per-stage profile of a frame: where time goes, on the CPU and on the GPU.
 * The two columns are NEVER added — they describe two machines that work at
 * the same time. `null` means "unmeasured" and is not zero: a stage that did not run,
 * a device without timestamps and a truncated sample all yield `null`, never `0`.
 */
export type StageQuantiles = { p50: number; p95: number } | null;

/** A profile row: a stage, its CPU duration and its GPU duration. */
export interface StageProfileEntry {
  stage: string;
  label: string;
  cpuMs: StageQuantiles;
  gpuMs: StageQuantiles;
  /** Why a column is `null`, when the reason is known. */
  cpuReason?: string;
  gpuReason?: string;
  /** Stage-specific counters (redrawn shadow faces, shadow draw calls, ...). */
  counts?: Readonly<Record<string, number>>;
}

export type GpuTimingMethod = 'timestamp-query' | 'EXT_disjoint_timer_query_webgl2';

/**
 * The full profile, over a sliding span of frames. `gpuImageMs` is the GPU envelope of the
 * frame: from the start of its first pass to the end of its last. Per-stage durations
 * do NOT add into it — a device that overlaps two passes counts them twice in
 * a sum, never in the envelope. It is also the only measurement of a WebGL2 engine, which cannot
 * split a frame into passes.
 */
export interface StageProfile {
  version: 1;
  enabled: boolean;
  backend: string;
  /** CPU frames and GPU samples actually retained by the span. */
  cpuFrames: number;
  gpuSamples: number;
  windowFrames: number;
  gpuMethod: GpuTimingMethod | null;
  gpuReason: string | null;
  gpuImageMs: StageQuantiles;
  /** CPU cost of the profile itself, per frame. This is what must be subtracted to be fair. */
  overheadMs: StageQuantiles;
  stages: StageProfileEntry[];
}

/** Nameable stages of a frame, in the order they occur. */
export const STAGE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  animations: 'Animations and transforms',
  lights: 'Lighting: preparing lists and shadows',
  hierarchyCut: 'Hierarchy cut',
  cutAdoption: 'Cut adoption',
  selection: 'Selection and visibility',
  transparents: 'Transparents',
  residency: 'Admission and residency queue',
  hostPages: 'Page lists handed to the host',
  uploads: 'Uploads',
  textures: 'Textures: order and transfers into the atlases',
  partition: 'Occluders / tested partition',
  encode: 'Pass encoding',
  submit: 'Submit',
  hiZ: 'Hi-Z (occlusion)',
  geometry: 'Geometry',
  coplanar: 'Coplanar layers',
  shadows: 'Shadows',
  sunFarShadows: 'Far shadows (sun against the proxy)',
  lightLists: 'Light lists',
  bounce: 'Bounce (irradiance probes)',
  lighting: 'Lighting (resolve)',
  antialiasing: 'Temporal antialiasing',
  present: 'Present',
  frame: 'Whole frame',
});

export const stageLabel = (stage: string) => STAGE_LABELS[stage] ?? stage;

/** p50 and p95 of a series, or `null` if it is empty: nothing is inferred from a missing series. */
export function stageQuantiles(values: readonly number[]): StageQuantiles {
  const summary = summarize(values);
  return summary ? { p50: summary.p50, p95: summary.p95 } : null;
}

/** Profile of an engine that keeps none: everything is "unmeasured", nothing is zero. */
export function disabledStageProfile(backend: string, reason: string): StageProfile {
  return {
    version: 1,
    enabled: false,
    backend,
    cpuFrames: 0,
    gpuSamples: 0,
    windowFrames: 0,
    gpuMethod: null,
    gpuReason: reason,
    gpuImageMs: null,
    overheadMs: null,
    stages: [],
  };
}
