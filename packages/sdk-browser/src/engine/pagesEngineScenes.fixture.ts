import * as G from '../host/graph/graph.fixture.ts'
import type { ClusterManifest } from '../../../sdk-core/src/index.ts'
import { DAG, type Cluster } from './pagesEngine.fixture.ts'

/** One indexed triangle over three `positions`; by default (−1, −1), (1, −1), (0, 1) at z = 0. */
export function triangleGeometry(positions = [-1, -1, 0, 1, -1, 0, 0, 1, 0]) {
  const geometry = new G.Geometry()
  geometry.setAttribute('position', G.floatAttribute(positions, 3))
  geometry.setIndex(G.indices([0, 1, 2]))
  return geometry
}

/** The quad's manifest without its primitives: a ready slice of two triangles over the DAG model. */
export const QUAD_MANIFEST: Omit<ClusterManifest, 'primitives'> = {
  ...DAG,
  schema: 1,
  status: 'ready',
  key: 'quad',
  scope: 'slice',
  sourceTriangles: 2,
  selectedTriangles: 2,
  selectedNodes: 0,
  totalNodes: 0,
}

/** A unit quad as two triangles: the source most page tests cluster. */
export function quadScene(material: G.GraphSurface = G.basicSurface()) {
  const geometry = new G.Geometry()
  geometry.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
  geometry.setIndex(G.indices([0, 1, 2, 0, 2, 3]))
  const mesh = G.mesh(geometry, material),
    source = new G.Group()
  source.add(mesh)
  return { geometry, material, mesh, source }
}

/** One cluster over the whole quad, three indices long. */
export function quadCluster(id: number, start?: number): Cluster {
  return {
    id,
    url: String(id),
    count: 3,
    min: [-1, -1, 0],
    max: [1, 1, 0],
    bytes: 12,
    sha256: 'x',
    ...(start === undefined ? {} : { start }),
  }
}

/** The indices each of the quad's two exact clusters draws. */
export const quadIndices = () =>
  new Map([
    ['0', new Uint32Array([0, 1, 2])],
    ['1', new Uint32Array([0, 2, 3])],
  ])

/** The camera every page test looks at the quad through. */
export function frontCamera() {
  const camera = G.perspectiveCamera(55, 1, 0.1, 100)
  camera.position.z = 5
  camera.lookAt(0, 0, 0)
  return camera
}

/** A transparent, double-sided fan of three triangles: clusters 0..2, plus the indices of their
 *  coarse replacements 3 and 4. */
export function fanScene() {
  const geometry = new G.Geometry()
  geometry.setAttribute(
    'position',
    G.floatAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -1, 0, 0], 3),
  )
  geometry.setIndex(G.indices([0, 1, 2, 0, 2, 3, 0, 3, 4]))
  const material = G.basicSurface({ transparent: true, side: G.DOUBLE_SIDE }),
    mesh = G.mesh(geometry, material),
    source = new G.Group()
  source.add(mesh)
  const indices = new Map([
    ['0', new Uint32Array([0, 1, 2])],
    ['1', new Uint32Array([0, 2, 3])],
    ['2', new Uint32Array([0, 3, 4])],
    ['3', new Uint32Array([0, 1, 3])],
    ['4', new Uint32Array([1, 2, 3])],
  ])
  return { geometry, material, mesh, source, indices }
}
