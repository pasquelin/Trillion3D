import type { PoolClamp } from './pools.ts'

/** A pool a refusal shrinks: the bytes it may hold, the bytes it holds, and why no more. */
export type ShrunkPool = { budgetBytes: number; allocatedBytes: number; clamp: PoolClamp }

/** The pools a refusal halves (`halvedPool`): the geometry, the texture and the shadow grants. */
export type HalvedPool = 'geometry' | 'texture' | 'shadow'

/**
 * THE ONE out-of-memory rule of the GPU pools (#483 rule 5): the refused pool is drawn again, by its
 * own rule `draw`, at half the bytes it would have held — the geometry and texture pools
 * (`../webgpu/residency/poolGrants.ts`), the shadow page pool
 * (`../webgpu/pages/render/vsm/vsmGrant.ts`). At its floor — where half draws no smaller pool: the
 * root cover of the geometry, the tails of each texture lane, the eighth of the shadow pages —
 * undefined.
 */
function halvedPool<P extends ShrunkPool>(pool: P, draw: (budgetBytes: number) => P) {
  const half = Math.floor(Math.min(pool.budgetBytes, pool.allocatedBytes) / 2)
  const smaller = half < 1 ? undefined : draw(half)
  return smaller && smaller.allocatedBytes < pool.allocatedBytes ? smaller : undefined
}

/** `first`, then each pool `halvedPool` draws after a refusal, down to the floor: what a grant asks
 *  the device for, in order, until it is granted. */
export function* halvings<P extends ShrunkPool>(first: P, draw: (budgetBytes: number) => P) {
  for (let pool: P | undefined = first; pool; pool = halvedPool(pool, draw)) yield pool
}

/** The context of a `gpu-out-of-memory` diagnostic: the pool refused, the bytes it asked for —
 *  `null` where no pool counts them — and the pool granted instead —
 *  `grantedBytes: null` when nothing smaller was. */
export const outOfMemoryContext = (
  pool: HalvedPool,
  requestedBytes: number | null,
  granted?: ShrunkPool,
) => ({
  kind: 'warning',
  pool,
  requestedBytes,
  grantedBytes: granted?.allocatedBytes ?? null,
  ...(granted && { clamp: granted.clamp }),
})
