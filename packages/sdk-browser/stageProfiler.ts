import {
  stageLabel,
  stageQuantiles,
  type GpuTimingMethod,
  type StageProfile,
  type StageProfileEntry,
} from '../sdk-core/index.ts';

/** Fenêtre glissante par défaut : deux secondes à 60 images par seconde. */
const DEFAULT_WINDOW = 120;

/** Un anneau de valeurs récentes. L'ordre est sans importance : seuls les quantiles sont lus. */
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
    get count() {
      return filled;
    },
  };
}
type Ring = ReturnType<typeof createRing>;

export type StageAdd = (stage: string, ms: number) => void;

/**
 * Le profil par étape d'un moteur : un anneau de durées par étape, côté processeur et côté carte
 * graphique, séparés et jamais additionnés. Une étape qui n'a rien déposé sur la fenêtre reste
 * « non mesuré » (`null`) ; elle ne vaut jamais zéro. Rien n'est alloué par image : les anneaux sont
 * des tableaux typés, et le coût du dépôt lui-même est chronométré dans `overheadMs`.
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
  // Une étape peut être alimentée par plusieurs bornes d'une même image : elles sont sommées ici,
  // puis déposées une seule fois. Sans cela, les quantiles mélangeraient des populations distinctes.
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
    /** Dépose les durées processeur d'une image, en se chronométrant lui-même. */
    frameCpu(fill: (add: StageAdd) => void) {
      collect(cpu, fill);
      cpuFrames++;
    },
    /** Dépose les durées d'un relevé carte graphique, qui décrit une image déjà passée. */
    frameGpu(fill: (add: StageAdd) => void) {
      collect(gpu, fill);
      gpuSamples++;
    },
    /** La durée de l'image entière, sur un moteur qui ne sait pas la découper en passes. */
    pushImageGpu(ms: number) {
      if (Number.isFinite(ms) && ms >= 0) image.push(ms);
    },
    /** Des compteurs attachés à une étape : ils ne sont pas des durées et ne s'additionnent à rien. */
    setCounts(stage: string, values: Record<string, number>) {
      counts.set(stage, values);
    },
    /** Pourquoi une étape n'a aucune durée, quand la raison est structurelle et non un oubli. */
    setReason(stage: string, reason: { cpu?: string; gpu?: string }) {
      if (reason.cpu) cpuReasons.set(stage, reason.cpu);
      if (reason.gpu) gpuReasons.set(stage, reason.gpu);
    },
    /** Le moyen de mesure retenu par l'appareil, découvert à l'exécution. */
    setGpuMethod(method: GpuTimingMethod | null, reason: string | null) {
      gpuMethod = method;
      gpuReason = reason;
    },
    /** Oublie la fenêtre : ce qui précède (chauffe, premières images) ne pèse plus sur les quantiles. */
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
