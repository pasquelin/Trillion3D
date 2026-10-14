import { encodePoolSort, POOL_SORT_STAGES } from './sort.ts'
import { POOL_SORT_WORDS, poolScratchWords } from './sortWords.ts'
import { groupWidth } from '../dispatch/grid.ts'
import { computeBufferEntry, computeUniformEntry } from '../core/computeBindings.ts'
import { startedComputeStages } from '../core/computeStages.ts'

/** Bytes of a pool sort's counts and scratch over at most `slots` slots, a burst of `burst`. */
export const poolSortBytes = (slots: number, burst: number) =>
  (POOL_SORT_WORDS + poolScratchWords(slots, burst)) * 4

/**
 * THE HOST SIDE OF A POOL'S VICTIM QUEUE (`sort.ts`), for a host whose program `code` holds the six
 * stages (`sortWgsl.ts`) on one group: the places' use words (read), the sort's counts and scratch,
 * the queue's output, the uniform — at a dynamic offset over `dynamicBytes` when given. Its stages
 * compile off the frame; `encode` does not run before they are `ready`.
 */
export function createPoolSortKit(
  device: GPUDevice,
  label: string,
  code: string,
  dynamicBytes?: number,
) {
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(0, 'read-only-storage'),
      computeBufferEntry(1, 'storage'),
      computeBufferEntry(2, 'storage'),
      computeUniformEntry(
        3,
        dynamicBytes === undefined
          ? undefined
          : { hasDynamicOffset: true, minBindingSize: dynamicBytes },
      ),
    ],
  })
  const module = device.createShaderModule({ label, code })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const stages = startedComputeStages(device, label, pipelineLayout, module, POOL_SORT_STAGES)
  const width = groupWidth(device.limits)
  return {
    /** Whether its six stages are compiled. */
    get ready() {
      return stages.ready
    },
    /** Its group over `use`, the sort's `counts`, the queue's `out` and `uniform`. */
    group: (use: GPUBuffer, counts: GPUBuffer, out: GPUBuffer, uniform: GPUBuffer) =>
      device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: use } },
          { binding: 1, resource: { buffer: counts } },
          { binding: 2, resource: { buffer: out } },
          {
            binding: 3,
            resource: { buffer: uniform, ...(dynamicBytes && { size: dynamicBytes }) },
          },
        ],
      }),
    /** The six dispatches over `slots` on `pass`, its group set. */
    encode: (pass: GPUComputePassEncoder, slots: number) =>
      encodePoolSort(pass, stages.pipelineOf, slots, width),
  }
}
