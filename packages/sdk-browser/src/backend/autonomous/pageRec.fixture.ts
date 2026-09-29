// A resident page record of the geometry store's tests, drawing one triangle, placed by the root
// `root` of rank 0.
import * as G from '../../host/graph/graph.fixture.ts';
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts';
import { surfaceOf } from '../../page/surface.ts';

export function makeRec(id: number, triangles: number): Required<Pick<PageRec, 'mesh'>> & PageRec {
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
    placementIndex: 0,
    renderOrder: 0,
    geometry: {} as G.Geometry,
    // The oracle copies a host matrix; the engine reads the sixteen floats of the contract.
    mesh: { matrix: { fromArray: () => {} } } as unknown as Required<PageRec>['mesh'],
    attached: false,
  };
}

/** The root of rank 0 the records of `makeRec` rank: the identity, placed by a row if `row`. */
export const recRoots = (row?: ClusterRoot<PageRec>['placement']): ClusterRoot<PageRec>[] => [
  { world: new G.Matrix4(), pages: [], placement: row },
];
