import { attachedPages, drawnInstancedAt } from '../../placement/autonomousPlacements.ts'
import type { createAutonomousRenderState } from './render.ts'
import type { createAutonomousResidency } from './residency.ts'
import type { createAutonomousPool } from './poolApi.ts'
import type { createAutonomousGeometry } from './geometry.ts'
import type { createSceneDraw } from '../../webgl/cluster/sceneDraw.ts'
import type { ClusterRoot, PageRec } from '../../page/selection/selection.ts'

/** The `metrics()` a WebGL2 autonomous backend returns: the cut's counters, the pool's, the
 *  draw calls and the coverage flags, gathered from the parts the factory holds. */
export function backendMetrics(parts: {
  state: ReturnType<typeof createAutonomousRenderState>
  pool: ReturnType<typeof createAutonomousPool>
  residency: ReturnType<typeof createAutonomousResidency>
  geometryStore: ReturnType<typeof createAutonomousGeometry>
  hostDraw: ReturnType<typeof createSceneDraw>
  shown: readonly PageRec[]
  roots: readonly ClusterRoot<PageRec>[]
  rootRankOf: (rec: PageRec) => number
  ready: boolean
}) {
  const { state, pool } = parts
  return {
    clusters: state.visible,
    ...state.triangles,
    ...pool.metrics,
    cacheEvictions: parts.residency.cacheEvictions,
    frustumRejected: state.frustumRejected,
    lodLevel: state.lodLevel,
    submittedTriangles: parts.geometryStore.state.submittedTriangles,
    totalSubmittedTriangles: parts.hostDraw.counters()?.triangles ?? null,
    drawCalls: attachedPages(parts.shown, (rec) =>
      drawnInstancedAt(parts.roots, parts.rootRankOf(rec), rec),
    ),
    coverageReady: parts.ready,
    coverageBudgetLimited: state.overBudget || pool.budget.coverageBudgetLimited,
    frameHeld: state.frameHeld,
  }
}
