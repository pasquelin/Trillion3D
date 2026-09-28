// #846: a class change restores some of the records a rowed page shares: the geometry the others
// still draw is not given back.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createAutonomousGeometry } from './geometry.ts';
import type { PageRec } from '../../page/selection/types.ts';
import { surfaceOf } from '../../page/surface.ts';

/** A resident record of page `u`, placed by a row. */
const rowed = (id: number, geometry: G.Geometry): PageRec => ({
  id,
  url: 'u',
  clusterId: `c${id}`,
  array: Uint32Array.of(0, 1, 2),
  triangles: 1,
  indexBytes: 12,
  min: [0, 0, 0],
  max: [1, 1, 1],
  depthLayer: 0,
  attributes: {} as G.Geometry['attributes'],
  material: surfaceOf({} as unknown as G.GraphSurface),
  declaration: {} as G.GraphSurface,
  matrix: new G.Matrix4(),
  renderOrder: 0,
  geometry,
  placement: {} as PageRec['placement'],
  attached: false,
});

test('records restored alone leave the rowed geometry the others draw', () => {
  const shared = new G.Geometry();
  let disposed = 0;
  shared.dispose = () => void disposed++;
  const [moved, kept] = [rowed(0, shared), rowed(1, shared)];
  const scene = { add() {}, remove() {} } as unknown as Parameters<
    typeof createAutonomousGeometry
  >[0]['scene'];
  const store = createAutonomousGeometry({
    ...{ scene, allPages: [moved, kept], bootstrap: [] },
    ...{ views: { live: { shown: [] }, lists: () => [] } },
    ...{ byUrl: new Map([['u', [moved, kept]]]), descriptors: new Map() },
    ...{ baseMaterials: new Map([[moved, new G.GraphSurface('basic') as never]]) },
    ...{ colorMaterials: new Map(), modifiedPages: new Set() },
  } as Parameters<typeof createAutonomousGeometry>[0]);
  store.restoreRecords([moved], {
    indices: Uint32Array.of(0, 1, 2),
    attributes: { position: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0) },
    vertexCount: 3,
    flags: 0,
    decodedBytes: 48,
    quantizationError: 0,
  });
  assert.equal(disposed, 0, 'the record left on the page still draws it');
  assert.equal(kept.geometry, shared);
  assert.notEqual(moved.geometry, shared);
});
