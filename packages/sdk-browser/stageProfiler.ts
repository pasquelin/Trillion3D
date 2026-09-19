import {
  stageLabel,
  stageQuantiles,
  type GpuTimingMethod,
  type StageProfile,
  type StageProfileEntry,
} from '../sdk-core/index.ts';

/** Default sliding window: two seconds at 60 images per second. */
const DEFAULT_WINDOW = 120;

/** A ring of recent values. Order does not matter: only the quantiles are read. */
function createRing(capacity: number) {
  const data = new Float64Array(capacity);
  let cursor = 0,
    filled = 0;
  return {
    push(value: number) {
      data[cursor % capacity] = value;
      cursor++;
      filled = Math.min(capacity, filled + 1);
    },
    values: () => Array.from(data.subarray(0, filled)),
    clear() {
      cursor = 0;
      filled = 0;
    },
  };
}
type Ring = ReturnType<typeof createRing>;

export type StageAdd = (stage: string, ms: number) => void;

/**
 * Per-step profile of an engine: a ring of durations per step, CPU side and GPU side, separate
 * and never added. A step that deposited nothing on the window stays "unmeasured" (`null`); it
 * is never zero. Nothing is allocated per image: the rings are typed arrays, and the cost of the
 * deposit itself is timed in `overheadMs`.
 */
export function createStageProfiler(options: {
  backend: string;
  stages: readonly string[];
  gpuMethod: GpuTimingMethod | null;
  gpuReason?: string | null;
  window?: number;
}) {
  const capacity = Math.max(8, Math.floor(options.window ?? DEFAULT_WINDOW));
  const cpu = new Map<string, Ring>(),
    gpu = new Map<string, Ring>();
  const overhead = createRing(capacity),
    image = createRing(capacity);
  const counts = new Map<string, Record<string, number>>();
  const gpuReasons = new Map<string, string>(),
    cpuReasons = new Map<string, string>();
  let cpuFrames = 0,
    gpuSamples = 0,
    gpuMethod = options.gpuMethod,
    gpuReason = options.gpuReason ?? null;
  const ringOf = (map: Map<string, Ring>, stage: string) => {
    let ring = map.get(stage);
    if (!ring) map.set(stage, (ring = createRing(capacity)));
    return ring;
  };
  // A step may be fed by several bounds of the same image: they are summed here, then deposited
  // once. Without that, the quantiles would mix distinct populations.
  const scratch = new Map<string, number>();
  const add: StageAdd = (stage, ms) => {
    if (Number.isFinite(ms) && ms >= 0) scratch.set(stage, (scratch.get(stage) ?? 0) + ms);
  };
  const collect = (map: Map<string, Ring>, fill: (add: StageAdd) => void) => {
    const started = performance.now();
    scratch.clear();
    fill(add);
    for (const [stage, ms] of scratch) ringOf(map, stage).push(ms);
    overhead.push(performance.now() - started);
  };
  return {
    /** Deposits the CPU durations of an image, timing itself. */
    frameCpu(fill: (add: StageAdd) => void) {
      collect(cpu, fill);
      cpuFrames++;
    },
    /** Deposits the durations of a GPU readback, which describes an image already past. */
    frameGpu(fill: (add: StageAdd) => void) {
      collect(gpu, fill);
      gpuSamples++;
    },
    /** Duration of the whole image, on an engine that cannot split it into passes. */
    pushImageGpu(ms: number) {
      if (Number.isFinite(ms) && ms >= 0) image.push(ms);
    },
    /** Counters attached to a step: they are not durations and add to nothing. */
    setCounts(stage: string, values: Record<string, number>) {
      counts.set(stage, values);
    },
    /** Why a step has no duration, when the reason is structural and not an omission. */
    setReason(stage: string, reason: { cpu?: string; gpu?: string }) {
      if (reason.cpu) cpuReasons.set(stage, reason.cpu);
      if (reason.gpu) gpuReasons.set(stage, reason.gpu);
    },
    /** Measurement means the device kept, discovered at run time. */
    setGpuMethod(method: GpuTimingMethod | null, reason: string | null) {
      gpuMethod = method;
      gpuReason = reason;
    },
    /** Forgets the window: what came before (warmup, first images) no longer weighs on the quantiles. */
    reset() {
      for (const ring of cpu.values()) ring.clear();
      for (const ring of gpu.values()) ring.clear();
      overhead.clear();
      image.clear();
      cpuFrames = 0;
      gpuSamples = 0;
    },
    profile(): StageProfile {
      const stages: StageProfileEntry[] = [];
      for (const stage of options.stages) {
        const cpuMs = stageQuantiles(cpu.get(stage)?.values() ?? []),
          gpuMs = stageQuantiles(gpu.get(stage)?.values() ?? []);
        const entry: StageProfileEntry = { stage, label: stageLabel(stage), cpuMs, gpuMs };
        if (!cpuMs) {
          const reason = cpuReasons.get(stage);
          if (reason) entry.cpuReason = reason;
        }
        if (!gpuMs) {
          const reason = gpuReasons.get(stage) ?? gpuReason;
          if (reason) entry.gpuReason = reason;
        }
        const stageCounts = counts.get(stage);
        if (stageCounts) entry.counts = stageCounts;
        stages.push(entry);
      }
      return {
        version: 1,
        enabled: true,
        backend: options.backend,
        cpuFrames,
        gpuSamples,
        windowFrames: capacity,
        gpuMethod,
        gpuReason,
        gpuImageMs: stageQuantiles(image.values()),
        overheadMs: stageQuantiles(overhead.values()),
        stages,
      };
    },
  };
}

export type StageProfiler = ReturnType<typeof createStageProfiler>;
