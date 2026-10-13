import type { PoolClamp } from './pools.ts'

/** A pool a refusal shrinks: the bytes it may hold, the bytes it holds, and why no more. */
export type ShrunkPool = { budgetBytes: number; allocatedBytes: number; clamp: PoolClamp }

/** The pools a refusal halves (`halvedPool`): the geometry and the texture grants. */
export type HalvedPool = 'geometry' | 'texture'

/** The pools a refused allocation names in its diagnostic: the halved ones, and the shadow pool,
 *  which is sized by the ledger's room instead (`../webgpu/pages/render/vsm/vsmGrant.ts`). */
type RefusedPool = HalvedPool | 'shadow'

/**
 * The out-of-memory rule of the geometry and texture pools (#483 rule 5,
 * `../webgpu/residency/poolGrants.ts`): the refused pool is drawn again, by its own rule `draw`, at
 * half the bytes it would have held. At its floor — where half draws no smaller pool: the root
 * cover of the geometry, the tails of each texture lane — undefined.
 */
export function halvedPool<P extends ShrunkPool>(pool: P, draw: (budgetBytes: number) => P) {
  const half = Math.floor(Math.min(pool.budgetBytes, pool.allocatedBytes) / 2)
  const smaller = half < 1 ? undefined : draw(half)
  return smaller && smaller.allocatedBytes < pool.allocatedBytes ? smaller : undefined
}

/** The context of a `gpu-out-of-memory` diagnostic: the pool refused, the bytes it asked for —
 *  `null` where no pool counts them — and the pool granted instead —
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
})
