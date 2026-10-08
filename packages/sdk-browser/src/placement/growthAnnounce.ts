import { noteWorldMoved } from '../webgpu/pages/render/movedWorlds.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

/**
 * The roots a growth `added` behind rank `first`, announced to the next image: placed by rows,
 * their worlds are the rows' (`updateWebgpuPlacements` wrote them), named and sent alone, the
 * scene's shape kept — no host walk, O(roots added) —; one placed by a host node brings sources to
 * watch, and every world is walked again.
 */
export function announceGrowth(
  rt: Pick<WebgpuPagesRuntime, 'run'>,
  added: readonly { placement?: unknown }[],
  first: number,
) {
  if (added.some((root) => !root.placement)) return rt.run.gate.sceneChanged()
  for (let k = 0; k < added.length; k++) noteWorldMoved(rt.run, first + k)
  rt.run.gate.engineMovedInPlace()
}
