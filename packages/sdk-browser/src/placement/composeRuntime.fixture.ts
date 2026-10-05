// The runtime a parent composes its roots under (`gpuCompose.ts`): its cut's roots, the shadow
// state a move declares to (the placements' mobility and the changed boxes), and its run state.
import { createShadowMobility } from '../webgpu/shadow/mobility.ts';
import {
  createShadowChanges,
  SHADOW_CHANGE_BOXES,
} from '../../../sdk-core/src/scene/light-shadow/changes.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

/** A runtime of `roots`, `run` merged over the run state every composition reads. */
export function composeRuntime(roots: readonly object[], run: object = {}) {
  return {
    layout: { selectionRoots: roots },
    lights: { mobility: createShadowMobility(), changes: createShadowChanges(SHADOW_CHANGE_BOXES) },
    blendState: { blendGpu: [] },
    gpu: {},
    run: { gate: { engineMovedInPlace() {} }, temporalHizState: {}, ...run },
  } as unknown as WebgpuPagesRuntime;
}
