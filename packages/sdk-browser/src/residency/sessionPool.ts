import { DEFAULT_GEOMETRY_POOL_BUDGET, geometryPoolFor } from './pools.ts'

/**
 * The geometry pool a session starts with (`budgetBytes`, the default when the host names none),
 * and the rule that redraws it mid-session (`setMemoryBudgets`) with no ceiling: the drawable-page
 * tables are sized for the first, and grow in place for a larger one (`growTables.ts`).
 */
export function sessionGeometryPool(
  options: Omit<Parameters<typeof geometryPoolFor>[0], 'budgetBytes'>,
  budgetBytes: number | undefined,
) {
  const poolFor = (bytes: number) => geometryPoolFor({ ...options, budgetBytes: bytes })
  return { pool: poolFor(budgetBytes ?? DEFAULT_GEOMETRY_POOL_BUDGET), poolFor }
}
