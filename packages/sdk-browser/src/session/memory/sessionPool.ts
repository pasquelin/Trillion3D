import { geometryPoolFor } from './pools.ts'
import { DEFAULT_GEOMETRY_POOL_BUDGET } from '../../../../sdk-core/src/contracts/poolBudgets.ts'

/**
 * The geometry pool a session starts with (`budgetBytes`, the default when the host names none),
 * and the rule that redraws it mid-session (`setMemoryBudgets`) with no ceiling: the cache is
 * laid out for the first, and drawn again in place for a larger one (`setGeometryBudget`,
 * `../../frame/io/memory.ts`). `shape`, the catalogue the rule reads, is read at each draw: the
 * pages a source added to the session brings (`growCatalogue`) change it in place.
 */
export function sessionGeometryPool(
  options: Omit<Parameters<typeof geometryPoolFor>[0], 'budgetBytes'>,
  budgetBytes: number | undefined,
) {
  const poolFor = (bytes: number) => geometryPoolFor({ ...options, budgetBytes: bytes })
  return { pool: poolFor(budgetBytes ?? DEFAULT_GEOMETRY_POOL_BUDGET), poolFor, shape: options }
}
