// A resident page record of the geometry store's tests, drawing one triangle, placed by the root
// `root` of rank 0. Its per-instance draw state is nowhere on the record: the tests carry it in a
// `PageDraws` table over these roots (`pageDraws.ts`).
import * as G from '../../host/graph/graph.fixture.ts'
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts'
import { surfaceOf } from '../../page/surface.ts'
import { createPageDraws } from './pageDraws.ts'

export function makeRec(id: number, triangles: number): PageRec {
  return {
    id,
    url: `u${id}`,
    clusterId: `c${id}`,
    array: new Uint32Array([0, 1, 2]),
    triangles,
    indexBytes: 12,
    min: [0, 0, 0],
    max: [1, 1, 1],
    depthLayer: 0,
    attributes: {} as G.Geometry['attributes'],
    material: surfaceOf({} as unknown as G.GraphSurface),
    declaration: {} as G.GraphSurface,
    renderOrder: 0,
  }
}

/** The root of rank 0 the records of `makeRec` rank: the identity, placed by a row if `row`. */
export const recRoots = (
  row?: ClusterRoot<PageRec>['placement'],
  pages: PageRec[] = [],
): ClusterRoot<PageRec>[] => [{ world: new G.Matrix4(), pages, placement: row }]

/** A draw table over `records`, all on the one root of rank 0: what the store's tests attach to. */
export const recDraws = (records: PageRec[], row?: ClusterRoot<PageRec>['placement']) =>
  createPageDraws(recRoots(row, records))

/** The decoded triangle restored by the page ownership tests. */
export const trianglePage = () => ({
  indices: Uint32Array.of(0, 1, 2),
  attributes: { position: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0) },
  vertexCount: 3,
  flags: 0,
  decodedBytes: 48,
  quantizationError: 0,
})
