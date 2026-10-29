import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

/** The placements the shadows keep, ranked as their mobility words are (`casters/mobilityState.ts`): how many. */
export const shadowRootCount = (rt: Pick<WebgpuPagesRuntime, 'layout' | 'lights'>) =>
  Math.min(rt.layout.selectionRoots.length, rt.lights.mobility.words.length)

/** The placement of `rank`, or none while it is parked or hidden (it casts nothing then). */
export function shadowRootAt(rt: Pick<WebgpuPagesRuntime, 'layout'>, rank: number) {
  const root = rt.layout.selectionRoots[rank]
  return root && !root.parked && !root.hidden ? root : undefined
}
