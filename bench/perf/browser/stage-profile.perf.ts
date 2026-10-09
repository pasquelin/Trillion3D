// per-stage profile breakdown, done every frame: CPU bounds deposited on their
// stages, and GPU passes read by their label.
import {
  stageQuantiles,
  type GpuPassTimings,
  type StageQuantiles,
} from '../../../packages/sdk-core/src/index.ts'
import {
  WEBGPU_STAGES,
  addGpuPasses,
  directLightTimings,
} from '../../../packages/sdk-browser/src/stage/mapping.ts'
import {
  createStageProfiler,
  type StageAdd,
} from '../../../packages/sdk-browser/src/stage/profiler.ts'
import {
  CPU_STEP_NAMES,
  CPU_STEP_STAGES,
} from '../../../packages/sdk-browser/src/webgpu/pages/render/cpuStepTable.ts'
import { xorshiftRandom, measure, parElement, stress, rapport } from '../../core/index.ts'
import {
  referenceAddCpuSteps,
  referenceDirectLightTimings,
  referenceGpuStages,
} from '../../oracles/browser/stage-profile.ts'

const alea = xorshiftRandom(113)

const NB_BORNES = CPU_STEP_NAMES.length

const lignes = (images: number): Float64Array[] =>
  Array.from({ length: images }, () => Float64Array.from({ length: NB_BORNES }, () => alea() * 10))

const depose =
  <Row>(ventile: (row: Row, add: StageAdd) => void) =>
  (rows: Row[]) => {
    const total = new Map<string, number>()
    const add: StageAdd = (stage, ms) => total.set(stage, (total.get(stage) ?? 0) + ms)
    for (const row of rows) ventile(row, add)
    return total
  }

/** Each stage's CPU spread once `rows` are filed by a profile whose window holds them all. */
const fileRows = (rows: Float64Array[]): Array<[string, StageQuantiles]> => {
  const profiler = createStageProfiler({
    backend: 'webgpu',
    steps: { names: CPU_STEP_NAMES, stages: CPU_STEP_STAGES },
    stages: WEBGPU_STAGES,
    gpuMethod: null,
    window: rows.length,
  })
  for (const row of rows) {
    profiler.row.set(row)
    profiler.record(0, 0)
  }
  return profiler.profile().stages.map((entry) => [entry.stage, entry.cpuMs])
}
const referenceFileRows = (rows: Float64Array[]): Array<[string, StageQuantiles]> => {
  const series = new Map<string, number[]>()
  for (const row of rows)
    for (const [stage, ms] of depose(referenceAddCpuSteps)([row]))
      series.set(stage, [...(series.get(stage) ?? []), ms])
  return WEBGPU_STAGES.map((stage) => [stage, stageQuantiles(series.get(stage) ?? [])])
}

const measureCpu = await measure({
  name: 'CPU bounds per stage',
  fichier: 'packages/sdk-browser/src/stage/profiler.ts',
  cas: [
    { name: `${NB_BORNES} bounds × 200 frames`, input: lignes(200), size: 200 * NB_BORNES },
    { name: 'no frames', input: [], size: 0 },
  ],
  calculation: fileRows,
  expected: referenceFileRows,
})

// A sample carries known passes, one unknown pass — which joins no stage —, a virtual shadow
// map pass — which joins "shadows" by its label's prefix — and, once in ten, a `null` duration
// that leaves its stage unmeasured. Half the timed passes carry their own share of the image, as a
// WebGPU timer gives it: a stage adds that share, not the pass's whole span.
const ETIQUETTES = [
  'Trillion3D DAG selection',
  'Trillion3D partition',
  'Trillion3D HiZ',
  'Trillion3D material surfaces v1',
  'vsm.pass',
  'Trillion3D light tiles v1',
  'Trillion3D bounce v1',
  'Trillion3D deferred lighting',
  'Trillion3D HDR composition + present',
  'Trillion3D unknown pass',
]
const reading = (passes: number): GpuPassTimings => ({
  frame: 0,
  totalMs: null,
  truncated: false,
  passes: Array.from({ length: passes }, (_, i) => {
    const gpuMs = alea() < 0.1 ? null : alea() * 2
    const ownMs = gpuMs !== null && alea() < 0.5 ? alea() * gpuMs : undefined
    return {
      name: ETIQUETTES[i % ETIQUETTES.length],
      gpuMs,
      ...(ownMs === undefined ? {} : { ownMs }),
    }
  }),
})
const releves = (n: number, passes: number): GpuPassTimings[] =>
  Array.from({ length: n }, () => reading(passes))

const truncatedSample: (GpuPassTimings | null)[] = [
  { frame: 0, totalMs: null, truncated: true, passes: [] },
]
const sansEchantillon: (GpuPassTimings | null)[] = [null]

const measureGpu = await measure({
  name: 'GPU passes per stage',
  fichier: 'packages/sdk-browser/src/stage/mapping.ts',
  cas: [
    { name: '200 samples of 22 passes', input: releves(200, 22), size: 200 * 22 },
    { name: 'truncated sample', input: truncatedSample, size: 1 },
    { name: 'no sample', input: sansEchantillon, size: 1 },
  ],
  calculation: depose(addGpuPasses),
  expected: depose(referenceGpuStages),
})

const measureLighting = await measure({
  name: 'direct-lighting durations',
  fichier: 'packages/sdk-browser/src/stage/mapping.ts',
  cas: [{ name: '1 000 samples', input: releves(1000, ETIQUETTES.length), size: 1000 }],
  calculation: parElement((sample: GpuPassTimings) => directLightTimings(sample)),
  expected: (input: GpuPassTimings[]) => input.map(referenceDirectLightTimings),
})

await stress({
  name: 'extreme per-stage profile',
  calculation: (sample) => {
    addGpuPasses(sample, () => {})
    directLightTimings(sample)
  },
  extremes: [
    {
      name: 'gpuMs NaN',
      input: {
        frame: 0,
        totalMs: null,
        truncated: false,
        passes: [{ name: 'Trillion3D partition', gpuMs: NaN }],
      },
    },
  ],
})

rapport(
  'profil-etapes',
  [measureCpu, measureGpu, measureLighting],
  'the per-stage profile deposits the same durations as its reference',
)
