import * as G from '../../host/graph/graph.fixture.ts'
import { Group, type Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { HostMesh } from '../../host/resources.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { graphDraws } from '../../page/selection/drawSource.ts'
import { DAG, dagRoots, exactPrimitive } from '../../engine/pagesEngine.fixture.ts'

/** Primitive `index`'s one root cluster, its triangle's three corners from 0. */
const roots = (index: number) =>
  dagRoots(
    [
      {
        id: 0,
        url: `p${index}`,
        count: 3,
        bytes: 12,
        sha256: `p${index}`,
        min: [-1, -1, 0],
        max: [1, 1, 0],
      },
    ],
    [0],
  )

/** Three primitives, one per material class, the way the compiler classifies them. */
export function scene() {
  const source = new Group(),
    meshes: HostMesh[] = [],
    associations = new Map<Object3D, { meshes: number; primitives: number }>()
  const materials = [
    // A cut-out: alphaMode MASK carries an alpha test and is not blended.
    G.standardSurface({ alphaTest: 0.5, side: G.DOUBLE_SIDE }),
    // A blend: alphaMode BLEND.
    G.standardSurface({ transparent: true, opacity: 0.4 }),
    // Transmission: thick glass or water, which reads what is already drawn behind it.
    G.physicalSurface({ transparent: true, transmission: 1 }),
  ]
  const passes = ['exact-clusters', 'clustered-blend', 'shared-blend']
  const primitives = materials.map((material, index) => {
    const geometry = new Geometry()
    geometry.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3))
    geometry.setIndex(G.indices([0, 1, 2]))
    const mesh = G.mesh(geometry, material)
    mesh.updateMatrixWorld(true)
    source.add(mesh)
    meshes.push(mesh)
    associations.set(mesh, { meshes: index, primitives: 0 })
    return {
      ...exactPrimitive(roots(index), index),
      pass: passes[index],
      clusterStrategy: DAG.clusterStrategy,
    }
  })
  source.updateMatrixWorld(true)
  const metadata = {
    errorModel: DAG.errorModel,
    clusterStrategy: DAG.clusterStrategy,
    primitives,
  } as unknown as ClusterManifest
  const indices = new Map(
    primitives.map((_, index) => [`p${index}`, new Uint32Array([0, 1, 2])] as const),
  )
  return {
    source,
    meshes,
    metadata,
    indices,
    associations,
    draws: graphDraws(source, associations),
  }
}
