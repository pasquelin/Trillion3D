import { checkBudget, DEFAULT_GEOMETRY_POOL_BUDGET, DEFAULT_TEXTURE_POOL_BUDGET } from './pools.ts'
import { DEFAULT_CACHED_BYTES } from '../streaming/pageCache.ts'
import { textureLevelShare } from '../texture/levelStore.ts'
import { effectChainBytesAt } from '../effects/targets.ts'
import { admittedPools, validateActiveMemory, type ActiveGpuMemory } from './activeMemory.ts'
import { SHADOW_POOL_BYTES, BOUNCE_PROBE_BYTES } from './shadowBudgetBytes.ts'
import { effectTargetReserve } from './effectReserve.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'

/** The largest canvas a budget declares: the effect chain's targets are reserved at its size. */
export interface BudgetCanvas {
  /** Width in pixels of the drawing buffer. */
  readonly width: number
  /** Height in pixels of the drawing buffer. */
  readonly height: number
}

/** The largest canvas a budget declares by default, in pixels of the drawing buffer: 3840 × 2160. */
export const DEFAULT_BUDGET_CANVAS: BudgetCanvas = Object.freeze({ width: 3840, height: 2160 })
/**
 * Bytes by which a chain's targets on a `width × height` image pass the reserve of the declared
 * `canvas`, by the same rule; 0 within it. The chain still draws the whole image: the excess is
 * only said (`effect-targets-over-budget`).
 */
export const effectTargetExcess = (width: number, height: number, canvas: BudgetCanvas) =>
  Math.max(0, effectChainBytesAt(width, height) - effectTargetReserve(canvas))
/** What no session holds yet: the default total is then its fixed shares and pools alone. */
const NOTHING_HELD: ActiveGpuMemory = Object.freeze({
  frameTargets: 0,
  frameShare: 0,
  shadowPool: 0,
  shadowReserve: 0,
  bounceProbes: 0,
  effectTargets: 0,
  geometryMinimum: 0,
  textureMinimum: 0,
})
/**
 * The GPU total by default for a declared canvas: the fixed shares — the shadows
 * (`SHADOW_POOL_BYTES`), the bounce probes, the effect chain's targets on the declared canvas —, then
 * the two pools at their defaults. Once a session said what it holds (`active`), each fixed share
 * is at least what it holds or reserves — the shadows still to be made (`shadowReserve`), a chain
 * on a canvas past the declared one —, the frame's share at the render scale's maximum on the real
 * canvas is added (`ActiveGpuMemory.frameShare`), and each pool is at its floor where a scene's
 * passes its default — a pool is raised to its floor by its own rule (`geometryPoolFor`,
 * `admittedPools`). The frame at full resolution is thus never what the pools leave: it is funded
 * before them, on any canvas, and follows it; only what else is live beside them, past what the
 * shares leave unused, presses them.
 */
export function defaultGpuBudget(
  canvas: BudgetCanvas = DEFAULT_BUDGET_CANVAS,
  active: ActiveGpuMemory = NOTHING_HELD,
) {
  return (
    Math.max(SHADOW_POOL_BYTES, active.shadowPool + active.shadowReserve) +
    BOUNCE_PROBE_BYTES +
    Math.max(effectTargetReserve(canvas), active.effectTargets) +
    active.frameShare +
    Math.max(DEFAULT_GEOMETRY_POOL_BUDGET, active.geometryMinimum) +
    Math.max(DEFAULT_TEXTURE_POOL_BUDGET, active.textureMinimum)
  )
}
/** The CPU total by default: the decoded-page cache's default, what a world's cache held before
 *  the tables were counted. */
export const DEFAULT_CPU_BUDGET = DEFAULT_CACHED_BYTES

/**
 * One memory budget, split by a fixed rule — never by what the machine says it has:
 * - GPU: the shadows first (`SHADOW_POOL_BYTES`), what the virtual shadow maps of one sun take at
 *   the default pool — their buffers, the raster's lists at their ceiling and the first
 *   transmission atlas; then the bounce probe cascades at their largest
 *   (`BOUNCE_PROBE_BYTES`), then the effect chain's targets on the declared `canvas`
 *   (`effectTargetReserve`, 3840 × 2160 by default); the rest in two halves, the geometry pool
 *   and the texture pool, each no larger than its ceiling. The three fixed shares never shrink: a total under them is
 *   refused by name. A total that leaves the other two less than their floors — the
 *   root cover, the texture tails — leaves them at those floors, which the pools' own clamps name.
 * - CPU: the decoded-page cache takes it all (`pageCache.ts`), the session's manifest tables and
 *   transfer queue reserved off it.
 *   The cut's host tables — the GPU cut publication's host mirrors: group closure, the rule's
 *   readiness, the residency sets and the cut's differences, sized by what the view asks for and
 *   the pool holds — are held in the cache's share too: the session reserves their bytes there
 *   (`hostTableBytes`, the streamer's `reserve`), read each time the cache weighs itself, and the
 *   decoded pages keep the rest. The decoded texture levels take at most `textureLevelShare` of it
 *   (`textureLevels`), and yield first to the pages a frame keeps.
 * With a session's `active` memory, each share is what it holds — the frame's targets with what
 * else is live beside the pools (`frameTargets`) — and the two pools the rest, less the shadows
 * still to be made (`shadowReserve`), within their floors and ceilings (`admittedPools`). At a canvas's default total (`defaultGpuBudget`), which funds the
 * frame at full resolution before the pools, the split gives each pool its own default while what
 * else is live fits in what the shares leave unused.
 */
export function splitMemoryBudget(
  gpu: number,
  cpu: number,
  canvas: BudgetCanvas = DEFAULT_BUDGET_CANVAS,
  active?: ActiveGpuMemory,
) {
  checkBudget(gpu, 'INVALID_GPU_BUDGET')
  checkBudget(cpu, 'INVALID_CPU_BUDGET')
  checkBudget(canvas.width, 'INVALID_BUDGET_CANVAS')
  checkBudget(canvas.height, 'INVALID_BUDGET_CANVAS')
  if (active) validateActiveMemory(active)
  const shadowPool = active?.shadowPool ?? SHADOW_POOL_BYTES
  const bounceProbes = active?.bounceProbes ?? BOUNCE_PROBE_BYTES
  const effectTargets = active?.effectTargets ?? effectTargetReserve(canvas)
  const fixed = shadowPool + bounceProbes + effectTargets + (active?.frameTargets ?? 0)
  if (!active && gpu < fixed) throw new Error('GPU_BUDGET_UNDER_SHADOW_POOL')
  const half = Math.floor((gpu - fixed) / 2)
  return {
    shadowPool,
    bounceProbes,
    effectTargets,
    ...(active ? { frameTargets: active.frameTargets } : {}),
    ...(active
      ? admittedPools(
          gpu - fixed,
          active.geometryMinimum,
          active.textureMinimum,
          DEFAULT_GEOMETRY_POOL_BUDGET,
          DEFAULT_TEXTURE_POOL_BUDGET,
          active.shadowReserve,
        )
      : {
          geometryPool: clamp(half, 1, DEFAULT_GEOMETRY_POOL_BUDGET),
          texturePool: clamp(half, 1, DEFAULT_TEXTURE_POOL_BUDGET),
        }),
    pageCache: cpu,
    textureLevels: textureLevelShare(cpu),
  }
}
