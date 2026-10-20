// The served world and a scene of one mesh, the world's one actor wearing a surface of it, the cut's
// world root built over it: what the world root's tests read (`worldRoot.test.ts`,
// `worldRootCover.test.ts`).
import type { TestContext } from 'node:test'
import type { ClusterManifest, Primitive } from '../../../../sdk-core/src/contracts/geometry.ts'
import { worldRootsDag } from '../../geometry/hlod/worldRootsPages.fixture.ts'
import { opened, served } from '../../geometry/hlod/worldRoots.fixture.ts'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { createPlacementRows } from '../../placement/rows/rows.ts'
import type { EngineContext } from '../../session/engine/types.ts'
import { drawSourceOf } from '../../geometry/selection/drawSource.ts'
import { sourceSurface } from '../../geometry/pages/surface.ts'

/** The served world, opened, its actor wearing a surface, and a scene of one mesh. */
export async function scene(t: TestContext) {
  const { clusters, groups, culling } = worldRootsDag()
  const { manifest, bin, table } = served(t, { dag: { clusters, groups, culling } })
  const metadata = {
    ...manifest,
    primitives: [{ mesh: 0, primitive: 0, pass: 'clustered' }] as Primitive[],
  } as ClusterManifest
  const mesh = G.triangleMesh(G.standardSurface()),
    source = G.mesh()
  source.add(mesh)
  const opaque = drawSourceOf(mesh, { meshes: 0, primitives: 0 })
  // Opened as a session's load opens it: its bundles read through the session's queue.
  const { roots: hold, queue } = await opened(t, metadata)
  hold.wear([sourceSurface(opaque)])
  const context = {
    metadata,
    source,
    draws: [opaque],
    worldRoots: hold,
    readGeometryPage: (url: string, own?: AbortSignal, priority?: number) =>
      queue.readBytes(url, own ?? queue.signal, priority),
  } as unknown as EngineContext
  return { context, hold, bin, table, opaque }
}

/** A placement's root: one opaque page of `mesh`, at row 0 of `rows`. */
export function placed(draw: unknown, rows = createPlacementRows(2)) {
  const page = { url: 'object', drawSource: draw, transparent: false, renderOrder: 3 }
  return {
    world: { elements: new Float64Array(16) },
    pages: [page],
    placement: { rows, index: 0 },
  }
}
