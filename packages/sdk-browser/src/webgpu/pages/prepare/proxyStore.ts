import type { WebgpuPagesRuntime } from '../runtime.ts'

/** Whether the view holds the run-time proxy's store: a placement or a copy wears a proxy, so that
 *  the selection made a buffer of it (`gpu/dag/proxyInstances.ts`). O(1). */
export const wantsProxyStore = (rt: Pick<WebgpuPagesRuntime, 'run'>) =>
  !!rt.run.gpuSelection?.proxyBuffers()

/**
 * At every image's start, before anything names it (`encodeVis`): the store of the run-time proxy's
 * answers is made the first time a placement wears a proxy, its bytes added to the frame's targets as the
 * lobes target's are (`followLobes`); a view that holds it from its making (`frameTargetAllocation`)
 * keeps it. It follows the size of the image, which remakes it with the reflection's targets.
 */
export function followProxyStore(rt: WebgpuPagesRuntime) {
  const { gpu } = rt
  const store = gpu.reflection?.store
  if (!store || store.view || !wantsProxyStore(rt)) return
  gpu.targetBytes += store.make()
}
