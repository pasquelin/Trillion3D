import type { Engine } from '../../../engine/types.ts'
import { createRayQueue } from '../../rays/rayQueue.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** The nearest drawn triangle a ray meets (`Engine.castRay`), through the session's one ray queue,
 *  made at the first cast: none on a session that lost its device or has none yet. */
export async function castWebgpuRay(
  rt: WebgpuPagesRuntime,
  ...[ray, filter, reach]: Parameters<Engine['castRay']>
) {
  const device = rt.gpu.device
  if (!device || rt.run.lost) return null
  return (rt.rays ??= createRayQueue(rt, device)).cast(ray, filter, reach)
}
