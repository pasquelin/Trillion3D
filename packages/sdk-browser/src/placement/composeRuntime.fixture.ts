// The runtime a parent composes its roots under (`gpuCompose.ts`): its cut's roots, the shadow
// state a move declares to (the placements' mobility and the changed boxes), and its run state.
import { createShadowMobility } from '../webgpu/shadow/mobility.ts'
import {
  createShadowChanges,
  SHADOW_CHANGE_BOXES,
} from '../../../sdk-core/src/scene/light-shadow/changes.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

/** A runtime of `roots` — a root given no pages holds none —, `run` merged over the run state
 *  every composition reads. */
export function composeRuntime(roots: readonly object[], run: object = {}) {
  for (const root of roots as { pages?: unknown[] }[]) root.pages ??= []
  return {
    layout: { selectionRoots: roots, rootIndex: { revision: 0 } },
    lights: { mobility: createShadowMobility(), changes: createShadowChanges(SHADOW_CHANGE_BOXES) },
    blendState: { blendGpu: [], blendIndex: { revision: 0 } },
    gpu: {},
    run: { gate: { engineMovedInPlace() {} }, ...run },
  } as unknown as WebgpuPagesRuntime
}
