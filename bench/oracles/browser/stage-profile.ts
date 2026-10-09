// Oracle of `packages/sdk-browser/src/stage/mapping.ts`, rewritten from its contract: a bound is deposited on its
// stage unless that stage is `null`; a pass is deposited by its label with its own share of the
// image (its span less what an earlier pass covered, the span itself where the timer gives no
// share), an unknown label on no stage; a `null` duration leaves its stage unmeasured, a
// truncated or missing sample deposits nothing.
import type { GpuPassTimings } from '../../../packages/sdk-core/src/index.ts'
import { VSM_PASS_PREFIX } from '../../../packages/sdk-browser/src/stage/passLabels.ts'
import type { StageAdd } from '../../../packages/sdk-browser/src/stage/profiler.ts'
import { CPU_STEP_STAGES } from '../../../packages/sdk-browser/src/webgpu/pages/render/cpuStepTable.ts'

// Stage of each label.
const STAGE_OF: Record<string, string> = {
  'Trillion3D DAG selection': 'selection',
  'Trillion3D partition': 'partition',
  'Trillion3D HiZ': 'hiZ',
  'Trillion3D material surfaces v1': 'geometry',
  'Trillion3D light tiles v1': 'lightLists',
  'Trillion3D bounce v1': 'bounce',
  'Trillion3D deferred lighting': 'lighting',
  'Trillion3D HDR composition + present': 'present',
}

// Every virtual shadow map pass is timed with the Shadows stage: the engine's own prefix.
const stageOf = (name: string) =>
  STAGE_OF[name] ?? (name.startsWith(VSM_PASS_PREFIX) ? 'shadows' : undefined)

export function referenceAddCpuSteps(row: ArrayLike<number>, add: StageAdd) {
  for (let i = 0; i < CPU_STEP_STAGES.length; i++) {
    const stage = CPU_STEP_STAGES[i]
    if (stage) add(stage, row[i])
  }
}

function totalsBy(
  sample: GpuPassTimings | null | undefined,
  groupOf: (name: string) => string | undefined,
): Map<string, number | null> {
  const totals = new Map<string, number | null>()
  if (!sample || sample.truncated) return totals
  for (const pass of sample.passes) {
    const group = groupOf(pass.name)
    if (group === undefined || totals.get(group) === null) continue
    const part = pass.gpuMs === null ? null : (pass.ownMs ?? pass.gpuMs)
    totals.set(group, part === null ? null : (totals.get(group) ?? 0) + part)
  }
  return totals
}

export function referenceGpuStages(sample: GpuPassTimings | null | undefined, add: StageAdd) {
  for (const [stage, ms] of totalsBy(sample, stageOf)) if (ms !== null) add(stage, ms)
}

export function referenceDirectLightTimings(sample: GpuPassTimings | null | undefined) {
  const totals = totalsBy(sample, stageOf)
  return {
    gpuLightListsMs: totals.get('lightLists') ?? null,
    gpuShadowsMs: totals.get('shadows') ?? null,
    gpuLightingMs: totals.get('lighting') ?? null,
  }
}
