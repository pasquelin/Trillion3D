// The selection view of a shadow region: what a cluster cut reads to select casters from the
// light. Its planes bound the region, not the camera; its scale turns a world error into the
// face's own texels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeFace, shadowOrthographic, shadowProjection } from './math.ts';
import { createFaceSelection, writeFaceSelection } from './selectionView.ts';

const inside = (planes: Float32Array, p: readonly number[]) => {
  for (let i = 0; i < 24; i += 4)
    if (planes[i] * p[0] + planes[i + 1] * p[1] + planes[i + 2] * p[2] + planes[i + 3] < 0)
      return false;
  return true;
};

test('a sun extent: its planes bound the extent box, and its error is counted in its texels', () => {
  // A sun looking down −z from z = 10, over a 4 m half-extent and 20 m of depth, on 1024 texels.
  shadowOrthographic(4, 20);
  composeFace(new Float32Array(16), 0, [0, 0, 10], [0, 0, -1]);
  const face = writeFaceSelection(createFaceSelection(), [-1, 0, -1, 1], 1024, 0, [0, 0, 0]);
  assert.equal(face.perspective, 0);
  assert.ok(Math.abs(face.focal - 1024 / 8) < 1e-3, 'texels per metre: side over extent');
  assert.equal(face.near, 0, 'an orthography has no near plane to measure against');
  // The left half of the face: x in [−4, 0] metres, the whole depth.
  assert.ok(inside(face.planes, [-2, 1, 0]), 'a point of the region');
  assert.ok(inside(face.planes, [-2, 1, -9.9]), 'a point deep in the map');
  assert.ok(!inside(face.planes, [1, 1, 0]), 'a point of the other half, beyond one texel');
  assert.ok(!inside(face.planes, [-2, 1, 10.1]), 'a point behind the light');
  assert.ok(inside(face.planes, [0.005, 1, 0]), 'the region is widened by one texel, 7.8 mm');
});

test('the planes and the view follow the render frame the cut works in', () => {
  shadowOrthographic(4, 20);
  composeFace(new Float32Array(16), 0, [100, 0, 10], [0, 0, -1]);
  const world = writeFaceSelection(createFaceSelection(), [-1, 1, -1, 1], 512, 0, [0, 0, 0]);
  const rendered = writeFaceSelection(createFaceSelection(), [-1, 1, -1, 1], 512, 0, [100, 0, 0]);
  // A point at x = 101 in the world is at x = 1 in a frame whose origin sits at x = 100.
  assert.ok(inside(world.planes, [101, 0, 0]) && inside(rendered.planes, [1, 0, 0]));
  assert.ok(!inside(rendered.planes, [101, 0, 0]));
  assert.ok(Math.abs(rendered.view[12] - world.view[12] - 100) < 1e-3);
});

test('a lamp face is perspective: its error is measured at depth, from its own near plane', () => {
  const planes = shadowProjection(Math.PI / 2, 10);
  composeFace(new Float32Array(16), 0, [0, 0, 0], [1, 0, 0]);
  const face = writeFaceSelection(
    createFaceSelection(),
    [-1, 1, -1, 1],
    256,
    planes.near,
    [0, 0, 0],
  );
  assert.equal(face.perspective, 1);
  assert.ok(Math.abs(face.focal - 128) < 1e-3, 'texels at unit depth: half the side over tan 45°');
  assert.equal(face.near, planes.near);
  assert.ok(inside(face.planes, [5, 0, 0]) && !inside(face.planes, [-5, 0, 0]));
});
