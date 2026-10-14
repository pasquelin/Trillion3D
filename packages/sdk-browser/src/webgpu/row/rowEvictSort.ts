import { encodePoolSort, POOL_SORT_STAGES, type PoolSortStage } from '../../gpu/pool/sort.ts'
import { POOL_SORT_WORDS, poolScratchWords } from '../../gpu/pool/sortWords.ts'
import { groupWidth } from '../../gpu/dispatch/grid.ts'
import { ROW_BURST } from '../../gpu/dag/readoutWords.ts'
import { computeBufferEntry, computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { preparedComputePipeline, started } from '../../lighting/deferred/fullscreen.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import { ROW_SORT_WGSL } from './rowEvictSortWgsl.ts'
import type { BufferMaker } from '../../gpu/dag/cutBuffers.ts'

/** Words of the sort's uniform: the clock, the live rows, the queue's first word in `out`, its
 *  burst. */
const UNIFORM_WORDS = 4

/**
 * THE ROWS' VICTIM QUEUE ON THE CUT'S PASS (`rowEvictSortWgsl.ts`): the pool's six dispatches over
 * the live rows, after the closure stamped them, its queue written into the readout the frame
 * copies. Its counts and scratch are its own, grown with the table; its group binds the use words,
 * the counts and `out`, made again when one of them is. Pipelines compiled off the frame: until they
 * are, it does not run, and says so.
 */
export function createRowEvictSort(
  device: GPUDevice,
  /** Makes its buffers, the counts in place of those they outgrew: the cut's (`cutBuffer`). */
  make: BufferMaker,
) {
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(0, 'read-only-storage'),
      computeBufferEntry(1, 'storage'),
      computeBufferEntry(2, 'storage'),
      computeUniformEntry(3),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D row eviction',
    code: ROW_SORT_WGSL,
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const stages = new Map(
    POOL_SORT_STAGES.map((entryPoint) => [
      entryPoint,
      started(
        preparedComputePipeline(device, {
          label: `Trillion3D row eviction ${entryPoint}`,
          layout: pipelineLayout,
          compute: { module, entryPoint },
        }),
      ),
    ]),
  )
  const pipelineOf = (stage: PoolSortStage) => stages.get(stage)!.get()
  const words = new Uint32Array(UNIFORM_WORDS),
    width = groupWidth(device.limits),
    bound = createWebgpuBindIdentity()
  let counts: GPUBuffer | undefined, uniform: GPUBuffer | undefined, group: GPUBindGroup | undefined
  return {
    /**
     * The queue of the `slots` live rows at `clock` on `pass`, at most `burst`, written at word
     * `queueAt` of `out`, ranked on `use`: false while its pipelines compile.
     */
    encode(
      pass: GPUComputePassEncoder,
      at: {
        use: GPUBuffer
        out: GPUBuffer
        queueAt: number
        clock: number
        slots: number
        burst: number
      },
    ) {
      if (![...stages.values()].every((stage) => stage.ready)) return false
      const bytes = (POOL_SORT_WORDS + poolScratchWords(Math.max(1, at.slots), ROW_BURST)) * 4
      if (!counts || counts.size < bytes) {
        const old = counts
        counts = make(
          {
            label: 'Trillion3D DAG row eviction counts',
            size: 2 * bytes,
            usage: GPUBufferUsage.STORAGE,
          },
          old,
        )
        old?.destroy()
      }
      uniform ??= make({
        label: 'Trillion3D DAG row eviction uniforms',
        size: UNIFORM_WORDS * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      words[0] = at.clock
      words[1] = at.slots
      words[2] = at.queueAt
      words[3] = at.burst
      device.queue.writeBuffer(uniform, 0, words)
      bound.next[0] = at.use
      bound.next[1] = counts
      bound.next[2] = at.out
      if (bound.moved() || !group)
        group = device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: { buffer: at.use } },
            { binding: 1, resource: { buffer: counts } },
            { binding: 2, resource: { buffer: at.out } },
            { binding: 3, resource: { buffer: uniform } },
          ],
        })
      pass.setBindGroup(0, group)
      encodePoolSort(pass, pipelineOf, at.slots, width)
      return true
    },
  }
}
