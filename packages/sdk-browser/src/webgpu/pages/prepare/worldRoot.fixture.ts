// The served world and a scene whose one mesh wears its primitive, the cut's world root built over
// it: what the world root's tests read (`worldRoot.test.ts`, `worldRootCover.test.ts`).
import type { TestContext } from 'node:test'
import type { ClusterManifest, Primitive } from '../../../../../sdk-core/src/index.ts'
import { worldRootsDag } from '../../../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { opened, served } from '../../../scene/worldRoots.fixture.ts'
import { worldOrGeometryReader } from '../../../scene/worldRoots.ts'
import * as G from '../../../host/graph/graph.fixture.ts'
import { createPlacementRows } from '../../../placement/rows.ts'
import { standAlone } from '../../../scene/worldSuperRoots.fixture.ts'
import type { EngineContext } from '../../../engine/types.ts'

/** The served world, opened, and a scene whose one mesh wears its primitive; with `alone`, one
 *  lone object past its cells, its copies in bundle 1, which cell 0 holds. */
export async function scene(t: TestContext, alone = false) {
  const cooked = worldRootsDag(),
    { clusters, groups } = cooked
  if (alone) standAlone(cooked, cooked.leaves, 1)
  const { manifest, bin, table } = served(t, { dag: { clusters, groups } })
  const metadata = {
    ...manifest,
    primitives: [{ mesh: 0, primitive: 0, pass: 'clustered' }] as Primitive[],
  } as ClusterManifest
  const opaque = G.triangleMesh(G.standardSurface()),
    source = G.mesh()
  source.add(opaque)
  const reads: string[] = []
  // Opened as a session's load opens it: its bundles read through the session's queue.
  const { roots: hold } = await opened(t, metadata)
  const host = async (url: string) => (reads.push(url), new Uint8Array(4))
  const context = {
    metadata,
    source,
    associations: new Map([[opaque, { meshes: 0, primitives: 0 }]]),
    worldRoots: hold,
    readGeometryPage: worldOrGeometryReader(hold, host, new AbortController().signal),
  } as unknown as EngineContext
  return { context, hold, bin, table, opaque, reads }
}

/** A placement's root: one opaque page of `mesh`, at row 0 of `rows`. */
export function placed(mesh: unknown, rows = createPlacementRows(2)) {
  const page = { url: 'object', sourceMesh: mesh, transparent: false, renderOrder: 3 }
  return {
    world: { elements: new Float64Array(16) },
    pages: [page],
    placement: { rows, index: 0 },
  }
}
