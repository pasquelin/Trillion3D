// A terrain for the GPU-cut frame bench: a grid of `side × side` leaf clusters of 32 triangles,
// every 4 × 4 block of them replaced by one coarse cluster of two triangles — a two-level DAG the
// cut refines near the eye and keeps coarse far from it. Pages stream in on demand (`readPage`),
// so residency, eviction and the cut's coarsening all have work, as on a real scene.
import * as G from '../../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import {
  DAG,
  MANIFEST_IDENTITY,
  clusterSphere,
} from '../../../../packages/sdk-browser/src/engine/pagesEngine.fixture.ts'
import type { ClusterManifest } from '../../../../packages/sdk-core/src/index.ts'

const CELL = 4,
  BLOCK = 4,
  /** A block's coarse error: refined within about 30 m of the eye at 720 px. */
  ERROR = 0.05

type Page = ClusterManifest['primitives'][number]['pages'][number]

export function cutFrameScene(side: number) {
  const verts = side * CELL + 1,
    positions: number[] = []
  for (let z = 0; z < verts; z++) for (let x = 0; x < verts; x++) positions.push(x, 0, z)
  const at = (x: number, z: number) => z * verts + x
  const all: number[] = [],
    indices = new Map<string, Uint32Array>(),
    pages: Page[] = []
  const cluster = (url: string, corners: number[], min: number[], max: number[], extra: object) => {
    indices.set(url, Uint32Array.from(corners))
    const id = pages.length,
      page = { id, url, count: corners.length, min, max, bytes: corners.length * 4, sha256: url }
    // Only the exact leaves cover the mesh's index buffer; a coarse cluster's corners are its own.
    const exact = (extra as { role: string }).role === 'exact'
    pages.push({
      ...page,
      start: exact ? all.length : 0,
      sphere: clusterSphere(page),
      ...extra,
    } as Page)
    if (exact) all.push(...corners)
    return id
  }
  const blocks = side / BLOCK,
    groups: {
      level: number
      error: number
      sphere: number[]
      children: number[]
      outputs: number[]
    }[] = [],
    roots: number[] = []
  for (let bz = 0; bz < blocks; bz++)
    for (let bx = 0; bx < blocks; bx++) {
      const span = BLOCK * CELL,
        [x0, z0] = [bx * span, bz * span]
      const sphere = clusterSphere({ min: [x0, 0, z0], max: [x0 + span, 0, z0 + span] }),
        group = groups.length,
        children: number[] = []
      for (let cz = 0; cz < BLOCK; cz++)
        for (let cx = 0; cx < BLOCK; cx++) {
          const [lx, lz] = [x0 + cx * CELL, z0 + cz * CELL],
            corners: number[] = []
          for (let qz = 0; qz < CELL; qz++)
            for (let qx = 0; qx < CELL; qx++) {
              const a = at(lx + qx, lz + qz)
              corners.push(a, a + verts, a + 1, a + 1, a + verts, a + verts + 1)
            }
          const leaf = { role: 'exact', level: 0, lodError: 0, group, source: null }
          const parent = { parentError: ERROR, parentSphere: sphere }
          children.push(
            cluster(`l${bx}-${bz}-${cx}-${cz}`, corners, [lx, 0, lz], [lx + CELL, 0, lz + CELL], {
              ...leaf,
              ...parent,
            }),
          )
        }
      const [a, b, c, d] = [
        at(x0, z0),
        at(x0 + span, z0),
        at(x0, z0 + span),
        at(x0 + span, z0 + span),
      ]
      const coarse = cluster(
        `r${bx}-${bz}`,
        [a, c, b, b, c, d],
        [x0, 0, z0],
        [x0 + span, 0, z0 + span],
        {
          role: 'coarse',
          level: 1,
          lodError: ERROR,
          parentError: null,
          parentSphere: null,
          group: null,
          source: group,
        },
      )
      groups.push({ level: 1, error: ERROR, sphere, children, outputs: [coarse] })
      roots.push(coarse)
    }
  const geometry = new G.Geometry()
  geometry.setAttribute('position', G.floatAttribute(positions, 3))
  geometry.setIndex(G.indices(all))
  const mesh = G.mesh(geometry, G.basicSurface()),
    source = new G.Group()
  source.add(mesh)
  const metadata: ClusterManifest = {
    ...DAG,
    ...MANIFEST_IDENTITY,
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        pages,
        structure: { version: 1, roots, groups },
      },
    ],
  }
  const associations = new Map([[mesh, { meshes: 0, primitives: 0 }]])
  return { source, metadata, indices, associations, pages: pages.length, leaves: side * side }
}
