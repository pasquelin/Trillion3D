import { checkBudget, DEFAULT_GEOMETRY_POOL_BUDGET, DEFAULT_TEXTURE_POOL_BUDGET } from './pools.ts';
import { DEFAULT_CACHED_BYTES } from '../streaming/pageCache.ts';
import { textureLevelShare } from '../texture/levelStore.ts';
import { effectChainBytesAt } from '../effects/targets.ts';
import { admittedPools, validateActiveMemory, type ActiveGpuMemory } from './activeMemory.ts';
import { SHADOW_POOL_BYTES, SHADOW_HOST_BYTES, BOUNCE_PROBE_BYTES } from './shadowBudgetBytes.ts';
import { effectTargetReserve } from './effectReserve.ts';

/** The largest canvas a budget declares: the effect chain's targets are reserved at its size. */
export interface BudgetCanvas {
  /** Width in pixels of the drawing buffer. */
  readonly width: number;
  /** Height in pixels of the drawing buffer. */
  readonly height: number;
}

/** The largest canvas a budget declares by default, in pixels of the drawing buffer: 3840 × 2160. */
export const DEFAULT_BUDGET_CANVAS: BudgetCanvas = Object.freeze({ width: 3840, height: 2160 });
/**
 * Bytes by which a chain's targets on a `width × height` image pass the reserve of the declared
 * `canvas`, by the same rule; 0 within it. The chain still draws the whole image: the excess is
 * only said (`effect-targets-over-budget`).
 */
export const effectTargetExcess = (width: number, height: number, canvas: BudgetCanvas) =>
  Math.max(0, effectChainBytesAt(width, height) - effectTargetReserve(canvas));
/** The GPU bytes reserved before the pools: the shadows, the probes, the effect targets. */
const fixedGpuBytes = (canvas: BudgetCanvas) =>
  SHADOW_POOL_BYTES + BOUNCE_PROBE_BYTES + effectTargetReserve(canvas);
/** The GPU total by default for a declared canvas: the fixed shares, then the two pools at their
 *  defaults. */
export const defaultGpuBudget = (canvas: BudgetCanvas = DEFAULT_BUDGET_CANVAS) =>
  fixedGpuBytes(canvas) + DEFAULT_GEOMETRY_POOL_BUDGET + DEFAULT_TEXTURE_POOL_BUDGET;
/** The CPU total by default: the shadow page table's host mirror, then the decoded-page cache's
 *  default, what a world's cache held before the mirror was counted. */
export const DEFAULT_CPU_BUDGET = SHADOW_HOST_BYTES + DEFAULT_CACHED_BYTES;

/**
 * One memory budget, split by a fixed rule — never by what the machine says it has:
 * - GPU: the shadow pool first (`SHADOW_POOL_BYTES`), what the atlas, its static layer and its
 *   transmittance layer take at 3840 × 2160 under one sun, with the page table and
 *   the other fixed shadow buffers; then the bounce probe cascades at their largest
 *   (`BOUNCE_PROBE_BYTES`), then the effect chain's targets on the declared `canvas`
 *   (`effectTargetReserve`, 3840 × 2160 by default); the rest in two halves, the geometry pool
 *   and the texture pool, each no larger than its ceiling. The three fixed shares never shrink: a total under them is
 *   refused by name. A total that leaves the other two less than their floors — the
 *   root cover, the texture tails — leaves them at those floors, which the pools' own clamps name.
 * - CPU: the shadow page table's host mirror first (`SHADOW_HOST_BYTES`), fixed whatever the
 *   screen; the decoded-page cache takes the rest (`pageCache.ts`), the session's manifest tables
 *   and transfer queue reserved off it. A total under the mirror is refused by name.
 *   The cut's host tables — group closure, the rule's readiness, the residency sets and the cut's
 *   differences, sized by what the view asks for and the pool holds (#483 rule 6) — are held in
 *   the cache's share too: the session reserves their bytes there (`hostTableBytes`, the
 *   streamer's `reserve`), read each time the cache weighs itself, and the decoded pages keep the
 *   rest. The decoded texture levels take at most `textureLevelShare` of it (`textureLevels`), and
 *   yield first to the pages a frame keeps.
 * At a canvas's default total (`defaultGpuBudget`), the split gives each pool its own default.
 */
export function splitMemoryBudget(
  gpu: number,
  cpu: number,
  canvas: BudgetCanvas = DEFAULT_BUDGET_CANVAS,
  active?: ActiveGpuMemory,
) {
  checkBudget(gpu, 'INVALID_GPU_BUDGET');
  checkBudget(cpu, 'INVALID_CPU_BUDGET');
  checkBudget(canvas.width, 'INVALID_BUDGET_CANVAS');
  checkBudget(canvas.height, 'INVALID_BUDGET_CANVAS');
  if (active) validateActiveMemory(active);
  const shadowPool = active?.shadowPool ?? SHADOW_POOL_BYTES;
  const bounceProbes = active?.bounceProbes ?? BOUNCE_PROBE_BYTES;
  const effectTargets = active?.effectTargets ?? effectTargetReserve(canvas);
  const fixed = shadowPool + bounceProbes + effectTargets + (active?.frameTargets ?? 0);
  if (!active && gpu < fixed) throw new Error('GPU_BUDGET_UNDER_SHADOW_POOL');
  if (cpu <= SHADOW_HOST_BYTES) throw new Error('CPU_BUDGET_UNDER_SHADOW_MIRROR');
  const half = Math.floor((gpu - fixed) / 2);
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
        )
      : {
          geometryPool: Math.max(1, Math.min(DEFAULT_GEOMETRY_POOL_BUDGET, half)),
          texturePool: Math.max(1, Math.min(DEFAULT_TEXTURE_POOL_BUDGET, half)),
        }),
    shadowMirror: SHADOW_HOST_BYTES,
    pageCache: cpu - SHADOW_HOST_BYTES,
    textureLevels: textureLevelShare(cpu - SHADOW_HOST_BYTES),
  };
}
