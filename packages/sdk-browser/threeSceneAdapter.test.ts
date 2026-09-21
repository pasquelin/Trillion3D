// The witness adapter without a context — a session that never draws on the host surface, and
// every Node test of a witness engine: nothing of the host library is touched until a draw, the
// draw is refused by name, and the frame counters say nothing before a frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createThreeSceneDraw } from './threeSceneAdapter.ts';

const output = { toneMapped: true, framebuffer: null, width: 1, height: 1 };

test('without a context the draw is refused by name, and dispose owes nothing', () => {
  const draw = createThreeSceneDraw(undefined, new THREE.Scene());
  draw.render(new THREE.PerspectiveCamera());
  assert.throws(() => draw.drawHostGeometry({} as never, output), /HOST_SURFACE_MISSING/);
  draw.dispose();
});

test('the counters are null before a frame, and zero once a frame opened without a draw', () => {
  const draw = createThreeSceneDraw(undefined, new THREE.Scene());
  assert.equal(draw.counters(), null);
  draw.render(new THREE.PerspectiveCamera());
  assert.deepEqual(draw.counters(), { calls: 0, triangles: 0 }, 'a held frame submits nothing');
});
