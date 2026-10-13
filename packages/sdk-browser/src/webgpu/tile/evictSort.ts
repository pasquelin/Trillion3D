import { PREVIEW_LAYOUT_NAMES } from '../../../../sdk-core/src/index.ts'
import { encodePoolSort, POOL_SORT_STAGES, POOL_SORT_WORDS } from '../../gpu/pool/sort.ts'
import { groupWidth } from '../../gpu/dispatch/grid.ts'
import { preparedComputePipeline, started } from '../../lighting/deferred/fullscreen.ts'
import { TEXTURE_EVICTION_PASS } from '../../stage/passLabels.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import { computeBufferEntry, computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { TILE_BURST, TILE_SORT_WGSL } from './evictSortWgsl.ts'
import type { TileSlotUse } from './slotUse.ts'
import type { WebgpuTilePool } from './pool.ts'

/** Words of one lane's queue: its count, then its places. */
const TILE_QUEUE_WORDS = 1 + TILE_BURST
/** Queues the sort fills: a lane of each of the two atlases. */
const TILE_QUEUES = 2 * PREVIEW_LAYOUT_NAMES.length
/** Bytes between two lanes' uniforms: WebGPU's dynamic offset alignment. */
const UNIFORM_STRIDE = 256
/** Cut records in turn: more than the feedback readbacks in flight (`feedback.ts`). */
const CUTS = 4

/** The queues a frame cut, carried by the feedback readback that copies `buffer`'s `bytes`
 *  (`feedback.ts`): `read` hands each lane sorted its queue. */
export type TileQueueCut = {
  readonly buffer: GPUBuffer
  readonly bytes: number
  read(words: Uint32Array): void
}

type Cut = TileQueueCut & {
  pools: (WebgpuTilePool | undefined)[]
  arrivals: Uint32Array
}

/**
 * THE TILE POOLS' VICTIM QUEUES (#1527): after the feedback reduction stamped the places its pixels
 * read (`stampWgsl.ts`), each lane pool short of a burst of free places is ranked on the GPU
 * (`evictSortWgsl.ts`), its queue copied back with the feedback list, and followed by the pool when
 * it lands (`placeOrder.ts`) with the arrivals it had at the cut. A pool with a burst free asks
 * none: its next arrivals take free places. Pipelines compiled off the frame.
 */
export function createTileEvictions(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(0, 'read-only-storage'),
      computeBufferEntry(1, 'storage'),
      computeBufferEntry(2, 'storage'),
      computeUniformEntry(3, { hasDynamicOffset: true, minBindingSize: 16 }),
    ],
  })
  const module = device.createShaderModule({
    label: TEXTURE_EVICTION_PASS,
    code: TILE_SORT_WGSL,
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const [count, place, scatter] = POOL_SORT_STAGES.map((entryPoint) =>
    started(
      preparedComputePipeline(device, {
        label: `Trillion3D texture eviction ${entryPoint}`,
        layout: pipelineLayout,
        compute: { module, entryPoint },
      }),
    ),
  )
  const buffer = (label: string, size: number, usage: number) =>
    device.createBuffer({ label: `Trillion3D texture eviction ${label}`, size, usage })
  const sortWords = buffer('counts', POOL_SORT_WORDS * 4, GPUBufferUsage.STORAGE)
  const queues = buffer(
    'queues',
    TILE_QUEUES * TILE_QUEUE_WORDS * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  )
  const uniform = buffer(
    'uniforms',
    TILE_QUEUES * UNIFORM_STRIDE,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )
  const words = new Uint32Array((TILE_QUEUES * UNIFORM_STRIDE) / 4)
  const bound = [createWebgpuBindIdentity(), createWebgpuBindIdentity()]
  const groups: GPUBindGroup[] = []
  const width = groupWidth(device.limits)
  const cut = (): Cut => {
    const made: Cut = {
      buffer: queues,
      bytes: TILE_QUEUES * TILE_QUEUE_WORDS * 4,
      pools: new Array(TILE_QUEUES).fill(undefined),
      arrivals: new Uint32Array(TILE_QUEUES),
      read(queueWords) {
        made.pools.forEach((pool, q) =>
          pool?.follow(
            queueWords.subarray(q * TILE_QUEUE_WORDS, (q + 1) * TILE_QUEUE_WORDS),
            made.arrivals[q],
          ),
        )
      },
    }
    return made
  }
  const cuts = Array.from({ length: CUTS }, cut)
  let turn = 0
  /** The group of atlas `a`, rebuilt when its places' words moved. */
  const groupOf = (a: number, use: GPUBuffer) => {
    bound[a].next[0] = use
    if (bound[a].moved())
      groups[a] = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: use } },
          { binding: 1, resource: { buffer: sortWords } },
          { binding: 2, resource: { buffer: queues } },
          { binding: 3, resource: { buffer: uniform, size: 16 } },
        ],
      })
    return groups[a]
  }
  return {
    /** Ranks every lane pool of `atlases` short of a burst of free places, at `clock`; the cut to
     *  carry back, none when no pool asked. */
    encode(
      encoder: GPUCommandEncoder,
      atlases: readonly { slotUse: TileSlotUse }[],
      clock: number,
    ): TileQueueCut | undefined {
      const record = cuts[turn]
      let sorted = 0
      atlases.forEach(({ slotUse }, a) =>
        slotUse.pools.forEach((pool, lane) => {
          const q = a * PREVIEW_LAYOUT_NAMES.length + lane
          record.pools[q] = undefined
          if (!pool || pool.tiles - pool.resident >= TILE_BURST) return
          record.pools[q] = pool
          record.arrivals[q] = pool.arrivals
          const at = (q * UNIFORM_STRIDE) / 4
          words[at] = slotUse.base(lane)
          words[at + 1] = pool.tiles
          words[at + 2] = clock
          words[at + 3] = q * TILE_QUEUE_WORDS
          sorted++
        }),
      )
      if (!sorted) return undefined
      device.queue.writeBuffer(uniform, 0, words)
      const pipelines = { count: count.get(), place: place.get(), scatter: scatter.get() }
      const pass = encoder.beginComputePass({ label: TEXTURE_EVICTION_PASS })
      atlases.forEach(({ slotUse }, a) =>
        slotUse.pools.forEach((_, lane) => {
          const q = a * PREVIEW_LAYOUT_NAMES.length + lane,
            pool = record.pools[q]
          if (!pool) return
          pass.setBindGroup(0, groupOf(a, slotUse.buffer), [q * UNIFORM_STRIDE])
          encodePoolSort(pass, pipelines, pool.tiles, width)
        }),
      )
      pass.end()
      turn = (turn + 1) % CUTS
      return record
    },
    destroy() {
      sortWords.destroy()
      queues.destroy()
      uniform.destroy()
    },
  }
}
