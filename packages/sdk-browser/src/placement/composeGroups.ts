import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'

/** A pass's bind group and what it names: made again only when one of them moves. */
export const heldGroup = () => ({
  identity: createWebgpuBindIdentity(),
  group: undefined as GPUBindGroup | undefined,
})
export type HeldGroup = ReturnType<typeof heldGroup>

/** `held`'s group over its entries (`identity.entries[0]`, read live) on `pipeline`'s group 0,
 *  made again when the pipeline or a resource they name moved (`entriesMoved`); whether it was. */
export function composeGroup(device: GPUDevice, held: HeldGroup, pipeline: GPUComputePipeline) {
  const moved = held.identity.entriesMoved(pipeline)
  if (moved)
    held.group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: held.identity.entries[0],
    })
  return moved
}
