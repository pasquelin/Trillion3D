import type { TexturePool } from '../webgpu/residency/memoryBudgets.ts'

/**
 * Engine memory budgets: FIXED-size pools, set by the host and never read off
 * the machine — free memory changes every instant, a budget read at startup would be wrong five
 * minutes later. What a view asks beyond the pool renders coarser; nothing is refused, nothing
 * stops. A value that cannot be held as-is is brought back to what can, and the reason is published
 * (`clamp`). The engine draws its geometry pool by this rule, its texture pools by
 * `../webgpu/residency/memoryBudgets.ts`.
 */
export const DEFAULT_GEOMETRY_POOL_BUDGET = 512 * 1024 * 1024
/** 512 MiB of textures, split between the colour and data atlases
 *  (`../webgpu/residency/memoryBudgets.ts`). */
export const DEFAULT_TEXTURE_POOL_BUDGET = 512 * 1024 * 1024

/** Bytes one storage buffer may occupy and bind on this device: the smaller of its limits. Every
 *  buffer sized from the device reads it — the page pool, and the DAG cut's per-primitive tables
 *  (`../gpu/dag/frameRanges.ts`). */
export const storageBufferCap = (limits?: {
  maxBufferSize?: number
  maxStorageBufferBindingSize?: number
}) => Math.min(limits?.maxBufferSize ?? Infinity, limits?.maxStorageBufferBindingSize ?? Infinity)

/** Bytes between two blocks of one uniform buffer bound at offsets: the device's alignment, never
 *  under the 256 WebGPU guarantees. */
export const uniformStride = (limits?: { minUniformBufferOffsetAlignment?: number }) =>
  Math.max(256, limits?.minUniformBufferOffsetAlignment ?? 256)

/** Why a pool does not make the requested size, or `null` when it does. */
export type PoolClamp =
  'root-cover' | 'scene' | 'page-cap' | 'device-limit' | 'minimum' | 'ceiling' | null

/** The geometry pool as it stands: slots, page size and bytes held. */ export type GeometryPool = {
  /** Bytes requested by the host, and the page slots the pool draws from them. */
  budgetBytes: number
  /** Page slots. */ slots: number
  /** Bytes per page. */ pageBytes: number
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
export const checkGeometryPoolBudget = (bytes: number) =>
  checkBudget(bytes, 'INVALID_GEOMETRY_POOL_BUDGET')

/**
 * Geometry page-pool slots for a budget in bytes, 512 MB by default. Root coverage always fits, its
 * resident root pages being outside the pool: a budget smaller than that cover is raised to it, by name.
 * A scene smaller than the budget takes only what it has, and a page cap (`maxResidentPages`, the
 * one benches and tests use) also bounds it. A pool that holds the
 * whole catalogue (`slots` at `uniquePages`) and knows its pages' own sizes (`homeBytes`,
 * `../gpu/page/homes.ts`) holds those bytes alone, not a slot of the widest page for each. The
 * DEVICE limit weighs the pool as it is held: past it, the pool keeps the slots the device holds;
 * a root cover no device's slots hold is held with every page at its own size when those fit, and
 * only a catalogue that fits no buffer at all is refused.
 */
export function geometryPoolFor(options: {
  budgetBytes: number
  pageBytes: number
  /** Resident geometry records outside page slots, included in this same budget. */
  fixedBytes?: number
  uniquePages: number
  /** The whole catalogue at its pages' own sizes, when the engine places it so. */
  homeBytes?: number
  rootPages: number
  maxResidentPages?: number
  limits?: Parameters<typeof storageBufferCap>[0]
}): GeometryPool {
  const { budgetBytes, pageBytes, uniquePages, maxResidentPages, limits } = options
  checkGeometryPoolBudget(budgetBytes)
  const fixedBytes = options.fixedBytes ?? 0
  const floor = Math.max(1, options.rootPages)
  let slots = Math.floor((budgetBytes - fixedBytes) / pageBytes),
    clamp: PoolClamp = null
  if (maxResidentPages !== undefined && maxResidentPages < slots) {
    slots = maxResidentPages
    clamp = 'page-cap'
  }
  if (uniquePages < slots) {
    slots = uniquePages
    clamp = 'scene'
  }
  if (slots < floor) {
    slots = floor
    clamp = 'root-cover'
  }
  const { homeBytes } = options
  /** Bytes a pool of `n` slots holds: every page at its own size when it holds the catalogue. */
  const held = (n: number) =>
    (homeBytes !== undefined && n >= uniquePages ? homeBytes : n * pageBytes) + fixedBytes
  const deviceBytes = storageBufferCap(limits)
  if (held(slots) > deviceBytes) {
    const deviceSlots = Math.floor((deviceBytes - fixedBytes) / pageBytes)
    if (deviceSlots >= floor) slots = deviceSlots
    else if (held(uniquePages) <= deviceBytes) slots = uniquePages
    else
      throw new Error(
        `GEOMETRY_POOL_DEVICE_LIMIT: ${floor} root pages of ${pageBytes} bytes, device allows ${deviceBytes}`,
      )
    clamp = 'device-limit'
  }
  return { budgetBytes, slots, pageBytes, allocatedBytes: held(slots), clamp }
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
  /** The drawable-page tables grown for a pool above them (WebGPU), or `null` when none was. */
  tables?: TableGrowthReport | null
  /** Bytes held at once while the geometry pool was copied: the previous pool and the new one
   *  beside it, granted together by the device before any page moved; 0 when no pool moved. */
  transientBytes?: number
}

/** The growth of the tables sized by drawable row, as a pool above them asked it. */
export type TableGrowthReport = {
  /** Visibility rows the tables now hold. */
  drawSlots: number
  /** Rows the shadow pass reads, after the visibility rows. */
  casterSlots: number
  /** Bytes the grown GPU tables hold — asked, when refused. */
  bytes: number
  /** True when the device refused them: the tables and the pool in place are kept. */
  refused: boolean
  /** Milliseconds the growth took, from the probe to the swap. */
  durationMs: number
}
