// A minimal `PageRec` fixture shared by benches that only exercise a handful of its fields
// (residency, streaming, shadow spheres): the rest are shared constants, allocated once, never
// read by the timed loop, so filling them costs nothing the bench's own numbers could move.
import * as G from '../../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import type { PageRec } from '../../../../packages/sdk-browser/src/page/selection/types.ts';
import { surfaceOf } from '../../../../packages/sdk-browser/src/page/surface.ts';

const DUMMY_ATTRIBUTES: G.GraphGeometry['attributes'] = {};
const IDENTITY_MATRIX = new G.Matrix4();
const DUMMY_BOUNDS: number[] = [0, 0, 0];

export function pageRecFixture(fields: Partial<PageRec> = {}): PageRec {
  return {
    id: 0,
    url: '',
    clusterId: '',
    triangles: 0,
    indexBytes: 0,
    min: DUMMY_BOUNDS,
    max: DUMMY_BOUNDS,
    depthLayer: 0,
    attributes: DUMMY_ATTRIBUTES,
    material: surfaceOf([]),
    declaration: [],
    matrix: IDENTITY_MATRIX,
    renderOrder: 0,
    attached: false,
    ...fields,
  };
}
