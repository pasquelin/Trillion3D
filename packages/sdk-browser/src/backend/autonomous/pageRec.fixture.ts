// A resident page record of the geometry store's tests, drawing one triangle.
import * as G from '../../host/graph/graph.fixture.ts';
import type { PageRec } from '../../page/selection/types.ts';
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
    matrix: new G.Matrix4(),
    renderOrder: 0,
    geometry: {} as G.Geometry,
    // The oracle copies a host matrix; the engine reads the sixteen floats of the contract.
    mesh: { matrix: { fromArray: () => {} } } as unknown as Required<PageRec>['mesh'],
    attached: false,
  };
}
