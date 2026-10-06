import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';

/** A quad facing the camera at depth `z`, of half-side `half`, with the normal a lit surface
 *  needs and the 32-bit index the owner's multi-draw ranges address. */
export const quad = (z: number, half = 1) => {
  const geometry = new G.Geometry();
  geometry.setAttribute(
    'position',
    G.floatAttribute([-half, -half, z, half, -half, z, half, half, z, -half, half, z], 3),
  );
  geometry.setAttribute('normal', G.floatAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setIndex(new G.BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1));
  return geometry;
};
