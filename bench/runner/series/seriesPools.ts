// Memory reservoirs of a series: what the bench asks of the engine, and what the engine says it
// held. Reservoirs are fixed, in bytes, like the reference's variables; an extreme value is a
// measurement case, and the reading says how the engine held it.
import type { FrameMetrics } from '../../../packages/sdk-core/src/index.ts'
import type { BenchSettings } from '../harness/options.ts'
import type { PageBudget, GeometryPool } from '../report/types.ts'

/** Reservoirs requested by the bench, for the measurement page; `null` leaves the engine default. */
export const reservoirs = ({
  maxPages,
  geometryPoolBytes,
  texturePoolBytes,
  geometryPoolCeilingBytes,
  livePools,
}: BenchSettings) => ({
  maxPages,
  geometryPoolBytes,
  texturePoolBytes,
  geometryPoolCeilingBytes,
  livePools,
})

/** The geometry pool as the engine held it, for `measure.json`; `null` = unpublished. */
export const geometryPool = (m: Partial<FrameMetrics>): GeometryPool => ({
  bytes: m.geometryPoolBytes ?? null,
  slots: m.geometryPoolSlots ?? null,
  allocated: m.geometryPoolAllocatedBytes ?? null,
  bound: m.geometryPoolClamp ?? null,
  saturated: m.geometryPoolSaturated ?? null,
})

/** The page budget as the last frame saw it: the cap asked, the pages held, whether the requested
 *  cut fits. */
export const pageBudget = (m: Partial<FrameMetrics>, maxPages: number | null): PageBudget => ({
  requested: maxPages ?? null,
  resident: m.residentPages ?? null,
  budgetLimitedCoverage: m.coverageBudgetLimited ?? null,
})
