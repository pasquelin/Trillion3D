import { PREVIEW_LAYOUT_NAMES } from '../../../../sdk-core/src/texture/previewFormat.ts'
import { createPoolSortKit, poolSortBytes } from '../../gpu/sort/sortKit.ts'
import { writeChangedSlots } from '../../gpu/core/writeChanged.ts'
import { uniformSlots } from '../../session/memory/pools.ts'
import { TEXTURE_EVICTION_PASS } from '../../diagnostic/stage/passLabels.ts'
import { POOL_MAX_LAYERS, TILES_PER_LAYER } from '../texture/tiles.ts'
import { TILE_BURST, TILE_PROTECTED, TILE_SORT_WGSL } from './evictSortWgsl.ts'
import {
  createQueueCuts,
  TILE_QUEUE_BYTES,
  TILE_QUEUES,
  TILE_QUEUE_WORDS,
  type TileQueueCut,
  type TileQueueRecord,
} from './queueCut.ts'
import type { TileSlotUse } from './slotUse.ts'

const PASS: GPUComputePassDescriptor = { label: TEXTURE_EVICTION_PASS }

/** Words of a lane's uniform: its first place, its places, the clock, its queue's first word. */
const UNIFORM_WORDS = 4

/** The sort kit, its buffers and what each queue remembers of its last cut. */
function createEvictionState(device: GPUDevice) {
  const kit = createPoolSortKit(
    device,
    TEXTURE_EVICTION_PASS,
    TILE_SORT_WGSL,
    UNIFORM_WORDS * 4,
    TILE_QUEUES / PREVIEW_LAYOUT_NAMES.length,
  )
  const buffer = (label: string, size: number, usage: number) =>
    device.createBuffer({ label: `Trillion3D texture eviction ${label}`, size, usage })
  // The sort's words, then its scratch over the most places a lane pool holds.
  const sortBytes = poolSortBytes(POOL_MAX_LAYERS * TILES_PER_LAYER, TILE_BURST)
  const sortWords = buffer('counts', sortBytes, GPUBufferUsage.STORAGE)
  const queues = buffer(
    'queues',
    TILE_QUEUE_BYTES,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  )
  const cuts = createQueueCuts(queues)
  const slots = uniformSlots(device.limits, TILE_QUEUES, UNIFORM_WORDS)
  const uniform = buffer('uniforms', slots.bytes, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
  return {
    device,
    kit,
    sortWords,
    queues,
    cuts,
    slots,
    uniform,
    words: new Uint32Array(slots.bytes / 4),
    /** Per queue: the clock and the pool's arrivals at its last cut. */
    cutClock: new Uint32Array(TILE_QUEUES),
    cutArrivals: new Uint32Array(TILE_QUEUES),
    /** Whether a pixel stamped since each queue's last cut. */
    stampedSince: new Uint8Array(TILE_QUEUES),
  }
}
type EvictionState = ReturnType<typeof createEvictionState>

/** Records into `record` the queues to rank and writes their uniforms; how many. */
function recordQueues(
  st: EvictionState,
  record: TileQueueRecord,
  atlases: readonly { slotUse: TileSlotUse }[],
  clock: number,
) {
  const { cutArrivals, cutClock, stampedSince, slots, words } = st
  const lanes = PREVIEW_LAYOUT_NAMES.length
  let sorted = 0
  for (let q = 0; q < TILE_QUEUES; q++) {
    const slotUse = atlases[Math.floor(q / lanes)]?.slotUse,
      pool = slotUse?.pools[q % lanes]
    record.pools[q] = undefined
    if (!slotUse || !pool || pool.tiles - pool.resident >= TILE_BURST) continue
    const held =
      pool.victims() > 0 &&
      pool.arrivals === cutArrivals[q] &&
      (!stampedSince[q] || clock - cutClock[q] < TILE_PROTECTED)
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
  return sorted
}

/** Ranks every lane pool of `atlases` short of a burst of free places whose queue may have
 *  moved, at `clock`, `stamped` when a pixel stamped this image; the cut to carry back, none
 *  when no pool asked. */
function encodeEvictions(
  st: EvictionState,
  encoder: GPUCommandEncoder,
  atlases: readonly { slotUse: TileSlotUse }[],
  clock: number,
  stamped: boolean,
): TileQueueCut | undefined {
  // A pixel's stamp is remembered whether or not a cut follows it.
  if (stamped) st.stampedSince.fill(1)
  // Nothing is cut, nor remembered of a cut, while the sort's stages compile.
  if (!st.kit.ready) return undefined
  const record = st.cuts.next()
  if (!recordQueues(st, record, atlases, clock)) return undefined
  writeChangedSlots(st.device, st.uniform, st.words, st.slots)
  const pass = encoder.beginComputePass(PASS)
  const lanes = PREVIEW_LAYOUT_NAMES.length
  for (let q = 0; q < TILE_QUEUES; q++) {
    const pool = record.pools[q]
    if (!pool) continue
    const a = Math.floor(q / lanes)
    const { kit, sortWords, queues, uniform, slots } = st
    kit.bind(pass, a, atlases[a].slotUse.buffer, sortWords, queues, uniform, slots.offset(q))
    kit.encode(pass, pool.tiles)
  }
  pass.end()
  st.cuts.turn()
  return record
}

/**
 * THE TILE POOLS' VICTIM QUEUES (#1527): after the feedback reduction stamped the places its pixels
 * read (`stampWgsl.ts`), each lane pool short of a burst of free places is ranked on the GPU
 * (`evictSortWgsl.ts`), its queue copied back with the feedback list, and followed by the pool when
 * it lands (`../../gpu/sort/slotOrder.ts`) with the arrivals it had at the cut. A pool with a
 * burst free asks
 * none: its next arrivals take free places. Nor does a pool whose queue holds victims, none of its
 * places arrived, pinned or unpinned since its last cut, and no pixel stamped since — or its cut is
 * younger than a use protects (`TILE_PROTECTED`): its queue names what a new one would, or a place
 * read less than then. Pipelines compiled off the frame.
 */
export function createTileEvictions(device: GPUDevice) {
  const st = createEvictionState(device)
  return {
    encode: (
      encoder: GPUCommandEncoder,
      atlases: readonly { slotUse: TileSlotUse }[],
      clock: number,
      stamped: boolean,
    ) => encodeEvictions(st, encoder, atlases, clock, stamped),
    destroy() {
      st.sortWords.destroy()
      st.queues.destroy()
      st.uniform.destroy()
    },
  }
}
