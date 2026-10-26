import { clamp } from '../../../../math/src/scalar/reals.ts'
import { joined } from '../../../../sdk-core/src/runtime/joined.ts'
import { microtaskOnce } from '../../../../sdk-core/src/runtime/microtaskOnce.ts'
import type { PhysicsBudget } from '../../../../sdk-core/src/physics/options.ts'
import type { ActiveGpuMemory } from '../memory/activeMemory.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import type { MeasuredWorld } from '../explorer.ts'
import {
  DEFAULT_GEOMETRY_POOL_BUDGET,
  DEFAULT_TEXTURE_POOL_BUDGET,
} from '../../../../sdk-core/src/contracts/poolBudgets.ts'
import {
  DEFAULT_BUDGET_CANVAS,
  defaultGpuBudget,
  splitMemoryBudget,
  type BudgetCanvas,
} from '../memory/memoryBudget.ts'
import {
  createPageCache,
  DEFAULT_CACHED_BYTES,
  type PageCache,
} from '../../geometry/streaming/pageCache.ts'

/** The pools a page asks for, the two totals and the declared canvas, kept to open every later session with them; and
 *  the world's decoded-page cache, which every session reads through — one reopened, on a device
 *  granted after a loss or on a changed scene, fetches nothing it holds. */
export type Pools = {
  geometryPool?: number
  texturePool?: number
  gpu?: number
  cpu?: number
  canvas?: BudgetCanvas
  activeGpu?: ActiveGpuMemory
  readonly pageCache: PageCache
}

/** A world's pools, none asked yet, and its page cache at its share of the default CPU total. */
export const worldPools = (): Pools => ({ pageCache: createPageCache(DEFAULT_CACHED_BYTES) })

/** The GPU total as asked, else the default total of the declared canvas beside what the session
 *  holds (`defaultGpuBudget`): its frame at full resolution funded before the pools. */
const gpuOf = (pools: Pools, canvas = pools.canvas, active = pools.activeGpu) =>
  pools.gpu ?? defaultGpuBudget(canvas, active)
/** The one call of the split rule: the totals as asked, defaults for those not set, `at`'s values
 *  (a write, an admission) in place of the pools' own. */
const splitOf = (pools: Pools, at: Partial<Pools> & { active?: ActiveGpuMemory } = {}) => {
  const { canvas = pools.canvas, active = pools.activeGpu } = at
  const gpu = at.gpu ?? gpuOf(pools, canvas, active)
  return splitMemoryBudget(gpu, at.cpu ?? pools.cpu ?? DEFAULT_CACHED_BYTES, canvas, active)
}
/**
 * What a session opens with: the pools as asked, and the world's page cache. Its admission
 * (`admitGpuMemory`) splits the total beside what the session holds, read anew from this session's
 * first admission. Under a total the page set, the pools the session is granted first are its own,
 * frozen: a byte the frame frees later stays free, never handed to a pool — they shrink when the
 * room runs short, never under their floors, and come back up to that grant; only a pool the page
 * asks (`world.budget`) may pass it. The default total needs no such hold: it funds the frame at
 * full resolution before the pools (`defaultGpuBudget`), which stay at their defaults.
 * What the session allocates is held to the total the page set and to none else (`limit`): the
 * default total divides the pools and refuses nothing, for the passes make their targets in the
 * middle of a frame, after the last funding, and a total that followed what the session holds would
 * always be late for the next one.
 */
export function sessionPools(pools: Pools) {
  let granted: { geometryPoolBytes: number; texturePoolBytes: number } | undefined
  // What another session held says nothing of this one.
  pools.activeGpu = undefined
  return {
    geometryPoolBytes: pools.geometryPool,
    texturePoolBytes: pools.texturePool,
    pageCache: pools.pageCache,
    admitGpuMemory: Object.assign(
      (active: ActiveGpuMemory) => {
        const split = splitOf(pools, { active })
        pools.activeGpu = { ...active }
        // A ceiling over the pool asked, never grown past it: prepare's tables are its (768 KiB on
        // memory-on-a-budget), and growing it refused the frame targets. The grant held is
        // a ceiling too, never under the floor the split keeps.
        const under = (
          asked: number | undefined,
          held: number | undefined,
          share: number,
          floor: number,
        ) => Math.min(asked ?? Math.max(held ?? share, floor), share)
        const admitted = {
          geometryPoolBytes: under(
            pools.geometryPool,
            granted?.geometryPoolBytes,
            split.geometryPool,
            active.geometryMinimum,
          ),
          texturePoolBytes: under(
            pools.texturePool,
            granted?.texturePoolBytes,
            split.texturePool,
            active.textureMinimum,
          ),
        }
        if (pools.gpu !== undefined) granted ??= admitted
        return admitted
      },
      { limit: () => pools.gpu },
    ),
  }
}

type Split = ReturnType<typeof splitOf>
type PoolKey = 'geometryPool' | 'texturePool'

/** The totals of `world.budget`: the physics envelopes, the GPU and CPU totals, the canvas, and the
 *  split of the totals. */
function budgetTotals(
  pools: Pools,
  physics: PhysicsBudget,
  redraw: (gpu: number, canvas?: BudgetCanvas) => void,
) {
  return {
    /** The physics envelopes (bodies, decorative bodies, memory), read once when the physics
     *  starts; exceeding one raises `PHYSICS_BUDGET`. */
    physics,
    /** Bytes of GPU memory the world may hold, all pools together; set it to redraw every pool
     *  by the split rule (`split`). A total under the three fixed shares — the shadow pool, the
     *  bounce probes and the effect targets — is refused (`GPU_BUDGET_UNDER_SHADOW_POOL`). Never
     *  read from the machine. Unset, the default total (`defaultGpuBudget`): the fixed shares, the
     *  frame's targets at full resolution on the canvas drawn once a session holds them, then the
     *  two pools at their defaults — the frame at rest is never drawn below the display for want
     *  of memory, and no allocation is refused for the total, which only divides the pools. Set,
     *  the page's total is the ceiling on what the world allocates: past it, the frame is drawn
     *  one eighth lower. */
    get gpu() {
      return gpuOf(pools)
    },
    set gpu(bytes: number) {
      redraw(bytes)
      pools.gpu = bytes
    },
    /** The largest canvas the world declares, in pixels of the drawing buffer: the effect chain's
     *  targets are reserved at its size (`split.effectTargets`); 3840 × 2160 by default, and the
     *  default `gpu` grows by that reserve. Set it to redraw every pool by the split. A canvas
     *  drawn larger still renders whole — the default `gpu` funds a chain's bytes past the
     *  reserve —: the diagnostics say `effect targets over budget` with those bytes. */
    get canvas(): BudgetCanvas {
      return pools.canvas ?? DEFAULT_BUDGET_CANVAS
    },
    set canvas({ width, height }: BudgetCanvas) {
      const canvas = Object.freeze({ width, height })
      redraw(gpuOf(pools, canvas), canvas)
      pools.canvas = canvas
    },
    /** Bytes of CPU memory the world may hold: the decoded pages, their manifest tables, their
     *  transfer queue and the engine's cut tables together. A change applies at once: pages leave
     *  by last use until they fit. Never read from the machine. */
    get cpu() {
      return pools.cpu ?? DEFAULT_CACHED_BYTES
    },
    set cpu(bytes: number) {
      const { pageCache } = splitOf(pools, { cpu: bytes })
      pools.cpu = bytes
      pools.pageCache.resize(pageCache)
    },
  }
}

/** The pools of `world.budget` and their ceilings: a write is clamped to its ceiling and to what
 *  the GPU total leaves it, and makes one rebalance. */
function budgetPools(
  pools: Pools,
  frames: { readonly last: FrameMetrics | null },
  rebalance: () => void,
  split: () => Split,
  room: (other: PoolKey, ceiling: number) => number,
) {
  // What the last frame published, `null` or `undefined` when it held no such pool.
  const held = (key: 'geometryPoolBytes' | 'texturePoolBytes') => frames.last?.[key]
  return {
    /** How the two totals are shared: the shadow pool and the bounce probes at their largest, the
     *  effect chain's targets on the declared `canvas`, then half each to the geometry and texture
     *  pools, capped at their ceilings; the decoded-page cache takes the whole CPU total,
     *  within which the session in place reserves its manifest tables, its transfer queue and the
     *  engine's cut tables. What the rule gives, before a pool set on its own. */
    get split() {
      return split()
    },
    /** The largest pools a world may ask for: the engine's starting budgets. */
    get geometryPoolCeiling() {
      return DEFAULT_GEOMETRY_POOL_BUDGET
    },
    /** The largest texture pool a world may ask for, in bytes. */
    get texturePoolCeiling() {
      return DEFAULT_TEXTURE_POOL_BUDGET
    },
    /** Bytes of GPU memory kept for geometry pages; set it to change the envelope, within what
     *  `gpu` leaves beside the shadows, the bounce probes and the texture pool. */
    get geometryPool() {
      return held('geometryPoolBytes') ?? pools.geometryPool ?? split().geometryPool
    },
    set geometryPool(bytes: number) {
      pools.geometryPool = Math.min(bytes, room('texturePool', DEFAULT_GEOMETRY_POOL_BUDGET))
      rebalance()
    },
    /** Bytes of GPU memory kept for texture pages; set it to change the envelope, within what
     *  `gpu` leaves beside the shadows, the bounce probes and the geometry pool. */
    get texturePool(): number {
      return held('texturePoolBytes') ?? pools.texturePool ?? split().texturePool
    },
    set texturePool(bytes: number) {
      pools.texturePool = Math.min(bytes, room('geometryPool', DEFAULT_TEXTURE_POOL_BUDGET))
      rebalance()
    },
  }
}

/**
 * `world.budget`: one GPU total and one CPU total, split across the pools by a fixed rule
 * (`splitMemoryBudget`), and the pools themselves, as properties. A pool write is clamped to its
 * ceiling and to what the GPU total leaves it, then applied with the session's `setMemoryBudgets`;
 * two writes before the next frame make one rebalance. A read is what the last frame held, or what
 * was asked before the first.
 */
export function worldBudget(
  pools: Pools,
  session: { readonly explorer: MeasuredWorld | null },
  frames: { readonly last: FrameMetrics | null },
  physics: PhysicsBudget,
) {
  const { schedule: rebalance } = microtaskOnce(
    () =>
      void session.explorer?.setMemoryBudgets({
        geometryPoolBytes: pools.geometryPool,
        texturePoolBytes: pools.texturePool,
      }),
  )
  const split = () => splitOf(pools)
  /** What the GPU total leaves a pool beside the fixed shares and the other pool as asked. */
  const room = (other: PoolKey, ceiling: number) => {
    const shares = split()
    return clamp(gpuOf(pools) - shares.fixed - (pools[other] ?? shares[other]), 1, ceiling)
  }
  /** Redraws both pools by the split of `gpu` on `canvas`; a refused total changes nothing. */
  const redraw = (gpu: number, canvas = pools.canvas) => {
    const shares = splitOf(pools, { gpu, canvas })
    pools.geometryPool = shares.geometryPool
    pools.texturePool = shares.texturePool
    rebalance()
  }
  return joined(
    budgetTotals(pools, physics, redraw),
    budgetPools(pools, frames, rebalance, split, room),
  )
}
