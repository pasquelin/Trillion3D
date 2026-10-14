import { encodePoolSort, POOL_SORT_STAGES } from './sort.ts'
import { POOL_SORT_WORDS, poolScratchWords } from './sortWords.ts'
import { groupWidth } from '../dispatch/grid.ts'
import {
  computeBufferEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../webgpu/core/bindIdentity.ts'
import { startedComputeStages } from '../core/computeStages.ts'

/** Bytes of a pool sort's counts and scratch over at most `slots` slots, a burst of `burst`. */
export const poolSortBytes = (slots: number, burst: number) =>
  (POOL_SORT_WORDS + poolScratchWords(slots, burst)) * 4

/**
 * THE HOST SIDE OF A POOL'S VICTIM QUEUE (`sort.ts`), for a host whose program `code` holds the six
 * stages (`sortWgsl.ts`) on one group: the places' use words (read), the sort's counts and scratch,
 * the queue's output, the uniform's `uniformBytes` at a dynamic offset. It keeps a group for each of
 * the host's `families`, made again when a buffer it binds moved. Its stages compile off the frame;
 * `encode` does not run before they are `ready`.
 */
export function createPoolSortKit(
  device: GPUDevice,
  label: string,
  code: string,
  uniformBytes: number,
  families = 1,
) {
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(0, 'read-only-storage'),
      computeBufferEntry(1, 'storage'),
      computeBufferEntry(2, 'storage'),
      computeUniformEntry(3, { hasDynamicOffset: true, minBindingSize: uniformBytes }),
    ],
  })
  const module = device.createShaderModule({ label, code })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const stages = startedComputeStages(device, label, pipelineLayout, module, POOL_SORT_STAGES)
  const width = groupWidth(device.limits)
  const bound = Array.from({ length: families }, () => createWebgpuBindIdentity())
  const groups: GPUBindGroup[] = []
  return {
    /** Whether its six stages are compiled. */
    get ready() {
      return stages.ready
    },
    /** Binds on `pass` the group of `family` over `use`, the sort's `counts`, the queue's `out` and
     *  `uniform` at the dynamic offset `offsets`, made again when one of them moved. */
    bind(
      pass: GPUComputePassEncoder,
      family: number,
      use: GPUBuffer,
      counts: GPUBuffer,
      out: GPUBuffer,
      uniform: GPUBuffer,
      offsets: readonly number[],
    ) {
      const next = bound[family].next
      next[0] = use
      next[1] = counts
      next[2] = out
      next[3] = uniform
      if (bound[family].moved())
        groups[family] = device.createBindGroup({
          layout,
          entries: sequentialEntries([
            { buffer: use },
            { buffer: counts },
            { buffer: out },
            { buffer: uniform, size: uniformBytes },
          ]),
        })
      pass.setBindGroup(0, groups[family], offsets)
    },
    /** The six dispatches over `slots` on `pass`, its group bound. */
    encode: (pass: GPUComputePassEncoder, slots: number) =>
      encodePoolSort(pass, stages.pipelineOf, slots, width),
  }
}
