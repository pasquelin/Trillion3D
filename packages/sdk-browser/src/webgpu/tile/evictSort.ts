import { PREVIEW_LAYOUT_NAMES } from '../../../../sdk-core/src/index.ts'
import {
  encodePoolSort,
  POOL_SORT_STAGES,
  POOL_SORT_WORDS,
  poolScratchWords,
  type PoolSortStage,
} from '../../gpu/pool/sort.ts'
import { EVICT_IN_USE } from '../../gpu/pool/rank.ts'
import { groupWidth } from '../../gpu/dispatch/grid.ts'
import { writeChangedSlots } from '../../gpu/core/writeChanged.ts'
import { uniformSlots } from '../../residency/pools.ts'
import { preparedComputePipeline, started } from '../../lighting/deferred/fullscreen.ts'
import { TEXTURE_EVICTION_PASS } from '../../stage/passLabels.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import { computeBufferEntry, computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { POOL_MAX_LAYERS, TILES_PER_LAYER } from '../../texture/tiles.ts'
import { TILE_BURST, TILE_SORT_WGSL } from './evictSortWgsl.ts'
import { createQueueCuts, TILE_QUEUES, TILE_QUEUE_WORDS, type TileQueueCut } from './queueCut.ts'
import type { TileSlotUse } from './slotUse.ts'

/** Words of a lane's uniform: its first place, its places, the clock, its queue's first word. */
const UNIFORM_WORDS = 4

/**
 * THE TILE POOLS' VICTIM QUEUES (#1527): after the feedback reduction stamped the places its pixels
 * read (`stampWgsl.ts`), each lane pool short of a burst of free places is ranked on the GPU
 * (`evictSortWgsl.ts`), its queue copied back with the feedback list, and followed by the pool when
 * it lands (`placeOrder.ts`) with the arrivals it had at the cut. A pool with a burst free asks
 * none: its next arrivals take free places. Nor does a pool whose queue holds victims, none of its
 * places arrived, pinned or unpinned since its last cut, and no pixel stamped since — or its cut is
 * younger than a use protects (`EVICT_IN_USE`): its queue names what a new one would, or a place
 * read less than then. Pipelines compiled off the frame.
 */
export function createTileEvictions(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(0, 'read-only-storage'),
      computeBufferEntry(1, 'storage'),
      computeBufferEntry(2, 'storage'),
      computeUniformEntry(3, { hasDynamicOffset: true, minBindingSize: UNIFORM_WORDS * 4 }),
    ],
  })
  const module = device.createShaderModule({ label: TEXTURE_EVICTION_PASS, code: TILE_SORT_WGSL })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const stages = new Map(
    POOL_SORT_STAGES.map((entryPoint) => [
      entryPoint,
      started(
        preparedComputePipeline(device, {
          label: `Trillion3D texture eviction ${entryPoint}`,
          layout: pipelineLayout,
          compute: { module, entryPoint },
        }),
      ),
    ]),
  )
  const pipelineOf = (stage: PoolSortStage) => stages.get(stage)!.get()
  const buffer = (label: string, size: number, usage: number) =>
    device.createBuffer({ label: `Trillion3D texture eviction ${label}`, size, usage })
  // The sort's words, then its scratch over the most places a lane pool holds.
  const sortBytes =
    (POOL_SORT_WORDS + poolScratchWords(POOL_MAX_LAYERS * TILES_PER_LAYER, TILE_BURST)) * 4
  const sortWords = buffer('counts', sortBytes, GPUBufferUsage.STORAGE)
  const cuts = createQueueCuts((bytes) =>
    buffer('queues', bytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC),
  )
  const slots = uniformSlots(device.limits, TILE_QUEUES, UNIFORM_WORDS)
  const uniform = buffer('uniforms', slots.bytes, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
  const words = new Uint32Array(slots.bytes / 4)
  const bound = [createWebgpuBindIdentity(), createWebgpuBindIdentity()]
  const groups: GPUBindGroup[] = []
  const width = groupWidth(device.limits)
  /** Per queue: the clock and the pool's arrivals at its last cut. */
  const cutClock = new Uint32Array(TILE_QUEUES),
    cutArrivals = new Uint32Array(TILE_QUEUES)
  /** Whether a pixel stamped since each queue's last cut. */
  const stampedSince = new Uint8Array(TILE_QUEUES)
  /** The group of atlas `a`, rebuilt when its places' words moved. */
  const groupOf = (a: number, use: GPUBuffer) => {
    bound[a].next[0] = use
    if (bound[a].moved())
      groups[a] = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: use } },
          { binding: 1, resource: { buffer: sortWords } },
          { binding: 2, resource: { buffer: cuts.buffer } },
          { binding: 3, resource: { buffer: uniform, size: UNIFORM_WORDS * 4 } },
        ],
      })
    return groups[a]
  }
  return {
    /** Ranks every lane pool of `atlases` short of a burst of free places whose queue may have
     *  moved, at `clock`, `stamped` when a pixel stamped this image; the cut to carry back, none
     *  when no pool asked. */
    encode(
      encoder: GPUCommandEncoder,
      atlases: readonly { slotUse: TileSlotUse }[],
      clock: number,
      stamped: boolean,
    ): TileQueueCut | undefined {
      const record = cuts.next()
      const lanes = PREVIEW_LAYOUT_NAMES.length
      let sorted = 0
      for (let q = 0; q < TILE_QUEUES; q++) {
        if (stamped) stampedSince[q] = 1
        const { slotUse } = atlases[Math.floor(q / lanes)] ?? {},
          pool = slotUse?.pools[q % lanes]
        record.pools[q] = undefined
        if (!slotUse || !pool || pool.tiles - pool.resident >= TILE_BURST) continue
        const held =
          pool.victims() > 0 &&
          pool.arrivals === cutArrivals[q] &&
          (!stampedSince[q] || clock - cutClock[q] < EVICT_IN_USE)
        if (held) continue
        record.pools[q] = pool
        record.arrivals[q] = cutArrivals[q] = pool.arrivals
        cutClock[q] = clock
        stampedSince[q] = 0
        const at = q * slots.strideWords
        words[at] = slotUse.base(q % lanes)
        words[at + 1] = pool.tiles
        words[at + 2] = clock
        words[at + 3] = q * TILE_QUEUE_WORDS
        sorted++
      }
      if (!sorted) return undefined
      writeChangedSlots(device, uniform, words, slots)
      const pass = encoder.beginComputePass({ label: TEXTURE_EVICTION_PASS })
      for (let q = 0; q < TILE_QUEUES; q++) {
        const pool = record.pools[q]
        if (!pool) continue
        const { slotUse } = atlases[Math.floor(q / lanes)]
        pass.setBindGroup(0, groupOf(Math.floor(q / lanes), slotUse.buffer), slots.offset(q))
        encodePoolSort(pass, pipelineOf, pool.tiles, width)
      }
      pass.end()
      cuts.turn()
      return record
    },
    destroy() {
      sortWords.destroy()
      cuts.buffer.destroy()
      uniform.destroy()
    },
  }
}
