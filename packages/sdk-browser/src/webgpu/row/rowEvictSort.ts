import { createPoolSortKit, poolSortBytes } from '../../gpu/pool/sortKit.ts'
import { ROW_BURST } from '../../gpu/dag/readoutWords.ts'
import { ROW_SORT_WGSL } from './rowEvictSortWgsl.ts'
import type { BufferMaker } from '../../gpu/dag/cutBuffers.ts'

/** Words of the sort's uniform: the clock, the live rows, the queue's first word in `out`, its
 *  burst. */
const UNIFORM_WORDS = 4
/** The dynamic offset of its one uniform slot. */
const AT_START = [0]

/**
 * THE ROWS' VICTIM QUEUE ON THE CUT'S PASS (`rowEvictSortWgsl.ts`): the pool's six dispatches over
 * the live rows, after the closure stamped them, its queue written into the readout the frame
 * copies. Its counts and scratch are its own, grown with the table; its group, the kit's, binds the
 * use words, the counts, `out` and its one uniform slot, made again when one of them is. Pipelines
 * compiled off the frame: until they are, it does not run, and says so.
 */
export function createRowEvictSort(
  device: GPUDevice,
  /** Makes its buffers, the counts in place of those they outgrew: the cut's (`cutBuffer`). */
  make: BufferMaker,
) {
  const kit = createPoolSortKit(device, 'Trillion3D row eviction', ROW_SORT_WGSL, UNIFORM_WORDS * 4)
  const words = new Uint32Array(UNIFORM_WORDS)
  let counts: GPUBuffer | undefined, uniform: GPUBuffer | undefined
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
      if (!kit.ready) return false
      const bytes = poolSortBytes(Math.max(1, at.slots), ROW_BURST)
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
      kit.bind(pass, 0, at.use, counts, at.out, uniform, AT_START)
      kit.encode(pass, at.slots)
      return true
    },
  }
}
