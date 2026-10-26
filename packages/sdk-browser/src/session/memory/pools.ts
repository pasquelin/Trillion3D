import type { TexturePool } from '../../geometry/residency/memoryBudgets.ts'
import type { RootSlots } from '../../geometry/pages/pool/placement.ts'

/**
 * Engine memory budgets: FIXED-size pools, set by the host and never read off
 * the machine — free memory changes every instant, a budget read at startup would be wrong five
 * minutes later. What a view asks beyond the pool renders coarser; nothing is refused, nothing
 * stops. A value that cannot be held as-is is brought back to what can, and the reason is published
 * (`clamp`). The engine draws its geometry pool by this rule, its texture pools by
 * `../../geometry/residency/memoryBudgets.ts`, from the budgets a host names or the defaults
 * (`../../../../sdk-core/src/contracts/poolBudgets.ts`).
 */

/** Bytes one storage buffer may occupy and bind on this device: the smaller of its limits. Every
 *  buffer sized from the device reads it — the page pool, and the DAG cut's buffers
 *  (`../../geometry/dag/bufferTable.ts`). */
export const storageBufferCap = (limits?: {
  maxBufferSize?: number
  maxStorageBufferBindingSize?: number
}) => Math.min(limits?.maxBufferSize ?? Infinity, limits?.maxStorageBufferBindingSize ?? Infinity)

/** Bytes between two blocks of one uniform buffer bound at offsets: the device's alignment, never
 *  under the 256 WebGPU guarantees. */
export const uniformStride = (limits?: { minUniformBufferOffsetAlignment?: number }) =>
  Math.max(256, limits?.minUniformBufferOffsetAlignment ?? 256)

/** Bytes `count` uniform slots occupy on a device of `limits`, `uniformStride` apart. */
export const uniformSlotBytes = (limits: Parameters<typeof uniformStride>[0], count: number) =>
  uniformStride(limits) * count

/** Slots of one uniform buffer bound at dynamic offsets: where each lies and what it holds. */
export type UniformSlots = {
  /** Slots the buffer holds. */
  readonly count: number
  /** Words a slot really holds, the struct its kernels read: the rest of its stride is never
   *  written nor compared. */
  readonly words: number
  /** Bytes between two slots: the device's `uniformStride`. */
  readonly stride: number
  /** Words between two slots: a slot's first word in an image laid as the buffer. */
  readonly strideWords: number
  /** Bytes the `count` slots occupy (`uniformSlotBytes`). */
  readonly bytes: number
  /** Slot `i`'s dynamic offset, one array a slot made once and kept, so a frame allocates none;
   *  past `count` only on a `growable` layout — a list whose slots grow with the frame — made the
   *  first time it is asked; a fixed layout refuses it. */
  offset(i: number): number[]
}

/** The layout of `count` uniform slots of `words` words on a device of `limits`: the one place
 *  where a slot's stride, its offsets and the bytes the slots occupy are drawn. `growable` lets
 *  `offset` go past `count` (the slots of a list as long as the frame's); otherwise it throws. */
export function uniformSlots(
  limits: Parameters<typeof uniformStride>[0],
  count: number,
  words: number,
  growable = false,
): UniformSlots {
  const stride = uniformStride(limits)
  if (words * 4 > stride) throw new Error(`UNIFORM_SLOT_WORDS: ${words} words past ${stride} bytes`)
  const offsets = Array.from({ length: count }, (_, i) => [i * stride])
  return {
    count,
    words,
    stride,
    strideWords: stride / 4,
    bytes: stride * count,
    offset: (i) => {
      if (i >= count && !growable) {
        throw new Error(`UNIFORM_SLOT_PAST_COUNT: slot ${i} of ${count} slots of ${words} words`)
      }
      return (offsets[i] ??= [i * stride])
    },
  }
}

/** Why a pool does not make the requested size, or `null` when it does. */
export type PoolClamp =
  'root-cover' | 'scene' | 'page-cap' | 'device-limit' | 'minimum' | 'ceiling' | null

/** The geometry pool as it stands: slots, page size and bytes held. */ export type GeometryPool = {
  /** Bytes requested by the host for the streaming slots: the root cover's are beside them. */
  budgetBytes: number
  /** Streaming page slots: the streaming slots and the root cover's grains. */ slots: number
  /** Bytes per streaming slot: the widest streaming page's. */ pageBytes: number
  /** The root cover's grains among the slots, behind the streaming ones, and the bytes of each
   *  (`../../geometry/pages/pool/placement.ts`). */
  roots: RootSlots
  /** Bytes held. */ allocatedBytes: number
  /** Why the size was limited. */ clamp: PoolClamp
}

/** A positive safe integer, refused with the caller's error identifier. */
export const checkBudget = (bytes: number, name: string) => {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error(name)
}
/** A texture budget refused by name before any pool is drawn from it. */
export const checkTexturePoolBudget = (bytes: number) =>
  checkBudget(bytes, 'INVALID_TEXTURE_POOL_BUDGET')
/** A geometry budget refused by name before any pool is drawn from it. */
const checkGeometryPoolBudget = (bytes: number) =>
  checkBudget(bytes, 'INVALID_GEOMETRY_POOL_BUDGET')

/**
 * Geometry page-pool slots for a budget in bytes, 512 MB by default: the STREAMING POOL, the slots
 * of the widest streaming page the budget holds — each slot one streaming page, its clusters packed
 * as the cache laid them (`../../geometry/pages/pool/placement.ts`) —, and BESIDE it the ROOT
 * REGION, a grain of `rootBytes` for each of the root cover's streaming pages (`rootPages`), which
 * the budget never pays for — the pool is both. The budget pays for the streaming slots alone. A
 * budget that holds no slot leaves the root cover alone, by name (`root-cover`). A scene smaller
 * than both takes only what it has, and a page cap (`maxResidentPages`, the one benches and tests
 * use) bounds the streaming slots. A pool that holds the whole catalogue (`slots` at
 * `uniquePages`, its streaming pages) and knows their own sizes (`homeBytes`,
 * `../../geometry/pages/pool/homes.ts`) holds those bytes alone, not a slot of the widest for each.
 * The DEVICE limit weighs the pool as it is held: past it, the pool keeps the streaming slots the
 * device holds beside the root region; a root cover no device holds so is held with every
 * streaming page at its own size when those fit, and only a catalogue that fits no buffer at all
 * is refused.
 */
export function geometryPoolFor(options: {
  budgetBytes: number
  pageBytes: number
  uniquePages: number
  /** The whole catalogue at its streaming pages' own sizes, when the engine places it so. */
  homeBytes?: number
  /** The root cover's streaming pages, held beside the streaming slots. */
  rootPages: number
  /** The bytes of a root grain, the widest root cover's page's: none, a streaming slot's. */
  rootBytes?: number
  maxResidentPages?: number
  limits?: Parameters<typeof storageBufferCap>[0]
}): GeometryPool {
  const { budgetBytes, pageBytes, uniquePages, maxResidentPages, limits } = options
  checkGeometryPoolBudget(budgetBytes)
  const roots: RootSlots = { slots: options.rootPages, bytes: options.rootBytes || pageBytes }
  const floor = Math.max(1, roots.slots)
  let streaming = Math.max(0, Math.floor(budgetBytes / pageBytes)),
    clamp: PoolClamp = null
  if (maxResidentPages !== undefined && maxResidentPages < streaming) {
    streaming = maxResidentPages
    clamp = 'page-cap'
  }
  if (streaming === 0) clamp = 'root-cover'
  let slots = floor + streaming
  if (uniquePages < slots) {
    slots = Math.max(uniquePages, floor)
    clamp = 'scene'
  }
  const { homeBytes } = options
  const rootBytes = roots.slots * roots.bytes
  /** Bytes a pool of `n` slots holds: every streaming page at its own size when it holds the
   *  catalogue, else its streaming slots and its root region. */
  const held = (n: number) =>
    homeBytes !== undefined && n >= uniquePages
      ? homeBytes
      : (n - roots.slots) * pageBytes + rootBytes
  const deviceBytes = storageBufferCap(limits)
  if (held(slots) > deviceBytes) {
    const deviceSlots =
      deviceBytes < rootBytes ? 0 : roots.slots + Math.floor((deviceBytes - rootBytes) / pageBytes)
    if (deviceSlots >= floor) slots = deviceSlots
    else if (held(uniquePages) <= deviceBytes) slots = uniquePages
    else
      throw new Error(
        `GEOMETRY_POOL_DEVICE_LIMIT: ${floor} root pages of ${roots.bytes} bytes, device allows ${deviceBytes}`,
      )
    clamp = 'device-limit'
  }
  return { budgetBytes, slots, pageBytes, roots, allocatedBytes: held(slots), clamp }
}

/** What a host can change mid-session; a missing field keeps its value. */
export type MemoryBudgets = {
  /** Bytes for geometry pages. */
  geometryPoolBytes?: number
  /** Bytes for texture tiles. */
  texturePoolBytes?: number
}

/** Pools as the engine holds them after the setting, and what the setting cost. */
export type MemoryBudgetsReport = {
  /** The geometry pool after the change. */
  geometryPool: GeometryPool
  /** `null` before prepare has drawn the lane pools: the budget is kept for it. */
  texturePool: TexturePool | null
  /** Pages and tiles the new pool could not keep: they will come back if the image asks again, their
   *  coarse level holding the place in the meantime. */
  evictedPages: number
  /** Texture tiles removed. */
  evictedTiles: number
  /** Pages whose geometry resided just before the setting and just after, counted by page as
   *  the frame metrics count them. */
  residentPages: { before: number; after: number }
  /** Texture tiles held, before and after. */
  residentTiles: { before: number; after: number }
  /** Time it took, a wait for the running prepare included. */
  durationMs: number
  /** Bytes held at once while the geometry pool was copied: the previous pool and the new one
   *  beside it, granted together by the device before any page moved; 0 when no pool moved. */
  transientBytes?: number
}
