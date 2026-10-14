// Root clusters by hand: one over a box, and two primitives each carrying its own.
import type { HostMesh } from '../../host/resources.ts'
import { DAG, dagRoots, exactPrimitive } from '../../engine/pagesEngine.fixture.ts'
import { drawSourceOf } from '../../page/selection/drawSource.ts'

/** One exact root cluster of three indices over the given box. */
export function rootPage(url: string, min: number[], max: number[]) {
  return { id: 0, url, count: 3, min, max, bytes: 12, sha256: 'x' }
}

/** Two primitives, one per mesh, each carrying its own root cluster over the first triangle. */
export function twoPrimitives(
  meshA: HostMesh,
  meshB: HostMesh,
  pageA: ReturnType<typeof rootPage>,
  pageB: ReturnType<typeof rootPage>,
) {
  const metadata = {
    errorModel: DAG.errorModel,
    clusterStrategy: DAG.clusterStrategy,
    primitives: [exactPrimitive(dagRoots([pageA])), exactPrimitive(dagRoots([pageB]), 1)],
  }
  const indices = new Map([
    [pageA.url, new Uint32Array([0, 1, 2])],
    [pageB.url, new Uint32Array([0, 1, 2])],
  ])
  const associations = new Map([
    [meshA, { meshes: 0, primitives: 0 }],
    [meshB, { meshes: 1, primitives: 0 }],
  ])
  const draws = [meshA, meshB].map((mesh) => drawSourceOf(mesh, associations.get(mesh)))
  return { metadata, indices, associations, draws }
}
