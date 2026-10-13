/**
 * THE LEVEL LOOP OF A BOTTOM-UP REFIT, written once for every tree the GPU fits again — the placement
 * tree (`treeRefit.ts`) and a posed copy of a mesh's proxy (`proxyPose.ts`): in one compute pass, a
 * dispatch a level from the deepest (`refitSchedule`, `placementTree.ts`), a thread a node of it, in
 * rows past a dimension's limit (`dispatchRows`, the kernel's `flatIndex`). The level's nodes are the
 * `count` ids from `first` in the kernel's own list; its parameters lie in a uniform slot of their own
 * (`uniformSlots`, the device's stride) — `first` and `count`, then the kernel's own words —, and go up
 * where they changed (`writeChangedSlots`).
 */
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { uniformSlots } from '../../residency/pools.ts'
import { writeChangedSlots } from '../core/writeChanged.ts'
import { dispatchRows } from '../dispatch/grid.ts'

/** Threads of a workgroup of every refit kernel: a node each. */
export const REFIT_LANES = 64

/** The parameters of `count` levels of `words` words each, in the buffer `params` a refit binds. */
export function createRefitLevels(device: GPUDevice, label: string, count: number, words: number) {
  const slots = uniformSlots(device.limits, count, words)
  const params = device.createBuffer({
    label,
    size: slots.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const image = new Uint32Array(slots.bytes / 4)
  return {
    params,
    slots,
    /** Level `step`'s parameters: the first of its nodes in the kernel's list and how many, then the
     *  kernel's own `extra` words. */
    set(step: number, first: number, nodes: number, extra: ArrayLike<number> = []) {
      const at = step * slots.strideWords
      image[at] = first
      image[at + 1] = nodes
      image.set(extra, at + 2)
    },
    /** Levels `[0, levels)` encoded in `pass`, the pipeline set: their parameters sent, then each level's
     *  group bound (`bind`) and its nodes dispatched. */
    encode(
      pass: GPUComputePassEncoder,
      levels: number,
      bind: (pass: GPUComputePassEncoder, step: number) => void,
    ) {
      writeChangedSlots(device, params, image, slots, 0, levels)
      for (let step = 0; step < levels; step++) {
        const nodes = image[step * slots.strideWords + 1]
        if (!nodes) continue
        bind(pass, step)
        dispatchRows(pass, ceilDiv(nodes, REFIT_LANES))
      }
    },
    dispose() {
      params.destroy()
    },
  }
}
export type RefitLevels = ReturnType<typeof createRefitLevels>
