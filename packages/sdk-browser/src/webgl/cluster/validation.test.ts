// #840: sponza's frame read the whole surface gate for each of its 1 465 pages; a surface's own
// part is read once a frame, its attributes per page, and a mutation still at the next draw.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as G from '../../host/graph/graph.fixture.ts';
import { ClusterMeshValidation } from './validation.ts';

const NO_COPIES = { plain: [], blended: [], transmissive: [] };

test('a frame reads a surface once for all its pages, their attributes each, a mutation next frame', () => {
  const surface = G.basicSurface();
  let reads = 0,
    blending = surface.blending;
  Object.defineProperty(surface, 'blending', {
    get: () => (reads++, blending),
    set: (value) => (blending = value),
  });
  const page = () => ({
    material: surface,
    geometry: { attributes: { position: new G.BufferAttribute(new Float32Array(9), 3) } },
  });
  const pages = [page(), page(), page()] as never[],
    validation = new ClusterMeshValidation(); // the renderer's, frame after frame
  validation.validate(pages, [], NO_COPIES);
  assert.equal(reads, 1, 'three pages, one read of their surface');
  (pages[2] as { geometry: { attributes: object } }).geometry.attributes = {};
  assert.throws(
    () => validation.validate(pages, [], NO_COPIES),
    /position attribute is unsupported/,
    'the attributes are read per page',
  );
  surface.premultipliedAlpha = true;
  assert.throws(
    () => validation.validate(pages, [], NO_COPIES),
    /unsupported blend state/,
    'the next frame reads the surface again',
  );
});
