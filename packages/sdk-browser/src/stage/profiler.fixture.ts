// The stage profiler the profile's tests file images through (`profilerStages.test.ts`,
// `profilerWindows.test.ts`): two bounds, each depositing onto a stage of its own.
import { createStageProfiler, cpuStepTable } from './profiler.ts'

const TWO = cpuStepTable([
  ['aMs', 'lights'],
  ['bMs', 'geometry'],
] as const)
/** The indices of the two stages the profiles below publish. */
export const LIGHTS = 0,
  GEOMETRY = 1

/** A profiler whose two bounds deposit onto \`lights\` and \`geometry\`, staged unless told not to. */
export const profilerOf = (
  options: { staged?: boolean; window?: number; stepCapacity?: number; worst?: number } = {},
) =>
  createStageProfiler({
    backend: 'webgpu',
    steps: TWO,
    stages: options.staged === false ? undefined : ['lights', 'geometry'],
    gpuMethod: null,
    window: options.window,
    stepCapacity: options.stepCapacity,
    worst: options.worst,
  })

/** Files one image whose bounds are \`a\` and \`b\`. */
export function file(profiler: ReturnType<typeof profilerOf>, frame: number, a: number, b: number) {
  profiler.row[0] = a
  profiler.row[1] = b
  profiler.record(frame, a)
}
