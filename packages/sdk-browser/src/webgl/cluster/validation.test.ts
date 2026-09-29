// #840: sponza's frame read the whole surface gate for each of its 1 465 pages; a surface's own
// part is read once a frame, its attributes per page, and a mutation still at the next draw.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as G from '../../host/graph/graph.fixture.ts';
import { clusterValidation } from './validation.ts';

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
    heard: string[] = [],
    validation = clusterValidation((_surface, leftOut) => void (leftOut && heard.push(leftOut)));
  validation.validate(pages, [], NO_COPIES); // the renderer's, frame after frame
  assert.equal(reads, 1, 'three pages, one read of their surface');
  (pages[2] as { geometry: { attributes: object } }).geometry.attributes = {};
  validation.validate(pages, [], NO_COPIES);
  assert.deepEqual(
    heard,
    ['position attribute is unsupported'],
    'the attributes are read per page',
  );
  assert.equal(validation.leaves(pages[2]), true);
  assert.equal(validation.leaves(pages[0]), false);
  surface.premultipliedAlpha = true;
  validation.validate(pages, [], NO_COPIES);
  assert.match(heard.at(-1)!, /unsupported blend state/, 'the next frame reads the surface again');
  assert.equal(validation.leaves(pages[0]), true);
});
