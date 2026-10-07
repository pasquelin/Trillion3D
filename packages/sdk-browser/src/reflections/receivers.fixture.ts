// The receivers the screen-reflection tests share: physical surfaces in a view's rows, and the
// shipped display resolve run over a stubbed trace.
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { SCREEN_REFLECTION_WGSL } from './screenWgsl.ts'
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts'
import { createWebgpuRowState } from '../webgpu/row/state.ts'
import type { PageRec } from '../page/selection/selection.ts'
import type { PageSurface } from '../page/surface.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

export const physical = (roughness: number) => ({ lit: true, model: 0, roughness }) as PageSurface

/** A beauty view whose rows hold `recs` and whose forward pass draws `forward`. */
export function rowsRuntime(recs: PageRec[], forward: PageSurface[] = []) {
  const rows = createWebgpuRowState([], recs.length)
  rows.packedCount = recs.length
  rows.packedRecs.splice(0, recs.length, ...recs)
  const rt = {
    run: { diagnostic: 'beauty' },
    gpu: {},
    layout: { rows },
    blendState: { blendGpu: forward.map((surface) => ({ surface })) },
  } as unknown as WebgpuPagesRuntime
  return { rows, rt }
}

/** A view whose rows wear the `opaque` surfaces, one row each. */
export const sceneOf = (opaque: PageSurface[], forward: PageSurface[] = []) =>
  rowsRuntime(
    opaque.map((material) => ({ material }) as PageRec),
    forward,
  ).rt

export const ENVIRONMENT = [3, 3, 3],
  RAY = [7, 7, 7],
  FILTERED = [5, 5, 5]

/** A shipped screen resolve's `resolvedRadiance` (by default the opaque one's), its trace
 *  answering `RAY` for the mirror ray and `FILTERED` for the cone on a hit and nothing on a miss,
 *  its fallback `reflectedRadiance` `ENVIRONMENT`; each call counted. `shader` and `globals` read
 *  another resolve. */
export function resolvedDisplay({
  enabled = 1,
  hit = true,
  weight = (rough: number) => +(rough <= Number(ROUGHNESS_FLOOR)),
  shader = SCREEN_REFLECTION_WGSL,
  globals = {} as Record<string, unknown>,
  functions = [] as string[],
} = {}) {
  const calls = { traced: 0, fallback: 0 }
  const program = shaderRun<
    Record<string, (P: number[], N: number[], R: number[], rough: number) => number[]>
  >(
    shader,
    [
      'resolvedReflectionRay',
      'filteredResolvedReflection',
      'screenReflectionFade',
      'resolvedRadiance',
      ...functions,
    ],
    {
      reflectionView: { enabled: [enabled, 0, 0, 0] },
      mirrorWeight: weight,
      screenReflection: () => (calls.traced++, hit ? [...RAY, 1] : [0, 0, 0, 0]),
      screenReflectionCone: () => (calls.traced++, hit ? [...FILTERED, 1] : [0, 0, 0, 0]),
      reflectedRadiance: () => (calls.fallback++, ENVIRONMENT),
      ...globals,
    },
  )
  return {
    calls,
    at: (rough: number) => program.resolvedRadiance!([0, 0, 0], [0, 1, 0], [0, 1, 0], rough),
  }
}
