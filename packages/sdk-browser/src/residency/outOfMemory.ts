import type { PoolClamp } from './pools.ts';

/** A pool a refusal shrinks: the bytes it may hold, the bytes it holds, and why no more. */
export type ShrunkPool = { budgetBytes: number; allocatedBytes: number; clamp: PoolClamp };

/** The pools a refused allocation names: WebGPU's three grants, and WebGL2's frame targets —
 *  the images and frame data a frame allocates at its own size. */
export type RefusedPool = 'geometry' | 'texture' | 'shadow' | 'target';

/**
 * THE ONE RULE OF AN OUT-OF-MEMORY REFUSAL (#483 rule 5), on WebGPU (`../webgpu/residency/
 * poolGrants.ts`) as on WebGL2 (`../backend/autonomous/pool.ts`): the refused pool is drawn again,
 * by its own rule `draw`, at half the bytes it would have held. At its floor — where half draws no
 * smaller pool: the root cover of the geometry, the tails of each texture lane — undefined.
 */
export function halvedPool<P extends ShrunkPool>(pool: P, draw: (budgetBytes: number) => P) {
  const half = Math.floor(Math.min(pool.budgetBytes, pool.allocatedBytes) / 2);
  const smaller = half < 1 ? undefined : draw(half);
  return smaller && smaller.allocatedBytes < pool.allocatedBytes ? smaller : undefined;
}

/** The context of a `gpu-out-of-memory` diagnostic: the pool refused, the bytes it asked for —
 *  `null` where no pool counts them: a frame target — and the pool granted instead —
 *  `grantedBytes: null` when nothing smaller was. */
export const outOfMemoryContext = (
  pool: RefusedPool,
  requestedBytes: number | null,
  granted?: ShrunkPool,
) => ({
  kind: 'warning',
  pool,
  requestedBytes,
  grantedBytes: granted?.allocatedBytes ?? null,
  ...(granted && { clamp: granted.clamp }),
});
