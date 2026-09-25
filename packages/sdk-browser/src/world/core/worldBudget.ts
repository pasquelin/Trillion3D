import type { PhysicsBudget } from '../../../../sdk-core/src/physics/index.ts';
import type { FrameMetrics } from '../../../../sdk-core/src/index.ts';
import type { MeasuredWorld } from '../session/explorer.ts';
import type { WorldRenderer } from '../capability/worldReady.ts';
import { DEFAULT_GEOMETRY_POOL_BUDGET } from '../../residency/pools.ts';
import { DEFAULT_TEXTURE_POOL_BUDGET } from '../../webgpu/residency/memoryBudgets.ts';
import {
  DEFAULT_CPU_BUDGET,
  DEFAULT_GPU_BUDGET,
  splitMemoryBudget,
} from '../../residency/memoryBudget.ts';
import { raycastTreeBudget } from '../../../../sdk-core/src/world/object/raycastTrees.ts';

/** The pools a page asks for, and the two totals, kept to open every later session with them. */
export type Pools = { geometryPool?: number; texturePool?: number; gpu?: number; cpu?: number };

/** The split of the totals as asked, the defaults for those not set. */
const splitOf = (pools: Pools) =>
  splitMemoryBudget(pools.gpu ?? DEFAULT_GPU_BUDGET, pools.cpu ?? DEFAULT_CPU_BUDGET);

/** What a session opens with: the pools as asked, and the page cache the CPU total gives. */
export const sessionPools = (pools: Pools) => ({
  geometryPoolBytes: pools.geometryPool,
  texturePoolBytes: pools.texturePool,
  maxCachedBytes: splitOf(pools).pageCache,
});

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
  renderer: () => WorldRenderer | null,
  physics: PhysicsBudget,
) {
  let pending = false;
  const rebalance = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      void session.explorer?.setMemoryBudgets({
        geometryPoolBytes: pools.geometryPool,
        texturePoolBytes: pools.texturePool,
      });
    });
  };
  // What the last frame published, `null` or `undefined` when it held no such pool.
  const held = (key: string) => (frames.last as Record<string, number | null> | null)?.[key];
  const split = () => splitOf(pools);
  /** What the GPU total leaves a pool beside the shadows and the other pool as asked. */
  const room = (other: 'geometryPool' | 'texturePool', ceiling: number) => {
    const shares = split();
    const left = (pools.gpu ?? DEFAULT_GPU_BUDGET) - shares.shadowPool;
    return Math.max(1, Math.min(ceiling, left - (pools[other] ?? shares[other])));
  };
  return {
    /** The physics envelopes (bodies, triangles, decorative bodies, memory), read once when the
     *  physics starts; exceeding one raises `PHYSICS_BUDGET`. */
    physics,
    /** Bytes of GPU memory the world may hold, all pools together; set it to redraw every pool
     *  by the split rule (`split`). A total under the shadow pool is refused
     *  (`GPU_BUDGET_UNDER_SHADOW_POOL`). Never read from the machine. */
    get gpu() {
      return pools.gpu ?? DEFAULT_GPU_BUDGET;
    },
    set gpu(bytes: number) {
      const shares = splitMemoryBudget(bytes, pools.cpu ?? DEFAULT_CPU_BUDGET);
      pools.gpu = bytes;
      pools.geometryPool = shares.geometryPool;
      pools.texturePool = shares.texturePool;
      rebalance();
    },
    /** Bytes of CPU memory the world may hold: the shadow page table's host mirror, then the
     *  decoded pages, taken by the next scene load. A total not above the mirror is refused
     *  (`CPU_BUDGET_UNDER_SHADOW_MIRROR`). Never read from the machine. */
    get cpu() {
      return pools.cpu ?? DEFAULT_CPU_BUDGET;
    },
    set cpu(bytes: number) {
      splitMemoryBudget(pools.gpu ?? DEFAULT_GPU_BUDGET, bytes);
      pools.cpu = bytes;
    },
    /** How the two totals are shared: the shadow pool at its largest, then half each to the
     *  geometry and texture pools, capped at their ceilings; the shadow table's host mirror, then
     *  the decoded-page cache takes the rest of the CPU total. What the rule gives, before a pool
     *  set on its own. */
    get split() {
      return split();
    },
    /** The largest pools a world may ask for: the engine's starting budgets. */
    get geometryPoolCeiling() {
      return DEFAULT_GEOMETRY_POOL_BUDGET;
    },
    /** The largest texture pool a world may ask for, in bytes. */
    get texturePoolCeiling() {
      return DEFAULT_TEXTURE_POOL_BUDGET;
    },
    /** Bytes of GPU memory kept for geometry pages; set it to change the envelope, within what
     *  `gpu` leaves beside the shadows and the texture pool. */
    get geometryPool() {
      return held('geometryPoolBytes') ?? pools.geometryPool ?? split().geometryPool;
    },
    set geometryPool(bytes: number) {
      pools.geometryPool = Math.min(bytes, room('texturePool', DEFAULT_GEOMETRY_POOL_BUDGET));
      rebalance();
    },
    /** Bytes of GPU memory kept for texture pages, `null` on an engine without a texture pool
     *  (WebGL2); set it to change the envelope, within what `gpu` leaves beside the shadows and
     *  the geometry pool. */
    get texturePool(): number | null {
      if (renderer() === 'webgl2') return null;
      return held('texturePoolBytes') ?? pools.texturePool ?? split().texturePool;
    },
    set texturePool(bytes: number) {
      pools.texturePool = Math.min(bytes, room('geometryPool', DEFAULT_TEXTURE_POOL_BUDGET));
      rebalance();
    },
    /** Bytes of CPU memory `raycast` keeps for triangle trees, shared by every world on the page;
     *  past it the tree cast at least recently is dropped. Set it to change the envelope. */
    get raycastTrees() {
      return raycastTreeBudget.bytes;
    },
    set raycastTrees(bytes: number) {
      raycastTreeBudget.bytes = bytes;
    },
  };
}
