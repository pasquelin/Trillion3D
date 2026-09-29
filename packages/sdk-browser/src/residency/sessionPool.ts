import { DEFAULT_GEOMETRY_POOL_BUDGET, geometryPoolFor } from './pools.ts';

/**
 * The geometry pool a session starts with (`budgetBytes`, the default when the host names none),
 * and the rule that redraws it mid-session (`setMemoryBudgets`): never above the session ceiling
 * (`ceilingBytes`, the starting budget when the host names none), drawn once here — what the
 * drawable-page tables of an engine that has them are sized by. An engine whose tables grow in
 * place (`grows`, WebGPU) sizes them so at the start and draws its pool with no ceiling.
 */
export function sessionGeometryPool(
  options: Omit<Parameters<typeof geometryPoolFor>[0], 'budgetBytes' | 'ceilingSlots'>,
  budgetBytes: number | undefined,
  ceilingBytes: number | undefined,
  grows = false,
) {
  const poolFor = (bytes: number, ceilingSlots?: number) =>
    geometryPoolFor({ ...options, budgetBytes: bytes, ceilingSlots });
  const pool = poolFor(budgetBytes ?? DEFAULT_GEOMETRY_POOL_BUDGET);
  const ceilingSlots = poolFor(Math.max(pool.budgetBytes, ceilingBytes ?? 0)).slots;
  const bound = grows ? undefined : ceilingSlots;
  return { pool, ceilingSlots, poolFor: (bytes: number) => poolFor(bytes, bound) };
}
