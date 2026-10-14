/**
 * The pipes of the shadow changes' stale (`castInvalidation.ts`): the stale's kernel over the
 * previous frame's tables and its own group — parameters, maps, the rows' list, the CPU's boxes —,
 * and the one-thread kernel that writes its indirect arguments.
 */
import { COMPUTE, computeBufferEntry } from '../gpu/core/computeBindings.ts'
import {
  CAST_ARGS_ENTRY,
  CAST_ARGS_WGSL,
  CAST_INVALIDATION_ENTRY,
  castInvalidationWgsl,
} from './castInvalidationWgsl.ts'
import { VSM_INVALIDATION_SPECS } from './invalidationWgsl.ts'
import type { VsmLayout } from './layout.ts'
import { vsmComputePipe } from './passKit.ts'
import { vsmBindGroupLayoutEntries } from './resources.ts'
import { VSM_PASS_PREFIX } from '../stage/passLabels.ts'

/** The pass that stales the shadow changes, its two kernels in it. */
export const CAST_LABEL = `${VSM_PASS_PREFIX}invalidateCastPages`

/** The stale's kernel and the arguments' kernel for `layout`, made once a device and source. */
export function vsmCastPipes(device: GPUDevice, layout: VsmLayout) {
  const [uniform, read, write] = (['uniform', 'read-only-storage', 'storage'] as const).map(
    (type) => (binding: number) => computeBufferEntry(binding, type),
  )
  return {
    stale: vsmComputePipe(
      device,
      CAST_LABEL,
      castInvalidationWgsl(layout),
      CAST_INVALIDATION_ENTRY,
      [
        vsmBindGroupLayoutEntries(VSM_INVALIDATION_SPECS, layout, COMPUTE),
        [uniform(0), read(1), read(2), read(3)],
      ],
    ),
    args: vsmComputePipe(device, CAST_LABEL, CAST_ARGS_WGSL, CAST_ARGS_ENTRY, [
      [uniform(0), read(1), write(2)],
    ]),
  }
}
