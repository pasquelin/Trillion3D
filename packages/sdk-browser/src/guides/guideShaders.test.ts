// The depth rule of the WebGPU guide pass: its TypeScript twin, and the shader that copies it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_WGSL, jitterDepthSlack } from './guideShaders.ts';

/** Reversed depth of a tilted plane at pixel `(x, y)`, the jitter `(jx, jy)` pixels applied. */
const plane =
  (jx = 0, jy = 0) =>
  (x: number, y: number) =>
    0.5 + 0.01 * (x - jx) - 0.03 * (y - jy);

test('the depth slack covers exactly what the jitter moved on a plane, and nothing unjittered', () => {
  const jitter = [-0.375, -0.1];
  const scene = plane(...(jitter as [number, number])),
    guide = plane()(4, 4);
  const slack = jitterDepthSlack(scene, 4, 4, jitter);
  assert.ok(Math.abs(slack - (0.375 * 0.01 + 0.1 * 0.03)) < 1e-12, 'jitter times slope, per axis');
  assert.ok(guide >= scene(4, 4) - slack, 'a guide on the plane passes the test');
  assert.ok(guide < scene(4, 4), 'where the bare test would have hidden it');
  assert.equal(jitterDepthSlack(scene, 4, 4, [0, 0]), 0, 'no jitter, no slack');
  assert.ok(0.4 < scene(4, 4) - slack, 'a guide behind the plane stays hidden');
});

test('a silhouette beside the pixel opens no hole: the gentler side gives the slope', () => {
  const edge = (x: number, y: number) => (x > 4 ? 0.1 : plane()(x, y));
  assert.ok(
    Math.abs(jitterDepthSlack(edge, 4, 4, [0.5, 0]) - 0.5 * 0.01) < 1e-12,
    'the far background right of the pixel is not a slope',
  );
});

test('the shader applies the rule of jitterDepthSlack: slack on the test, gentler side, |jitter|', () => {
  assert.match(
    GUIDE_WGSL,
    /if \(in\.position\.z < scene - jitterSlack\(p, scene\)\) \{ discard; \}/,
  );
  assert.match(
    GUIDE_WGSL,
    /min\(abs\(sceneAt\(p \+ axis\) - centre\), abs\(centre - sceneAt\(p - axis\)\)\)/,
  );
  assert.match(GUIDE_WGSL, /abs\(view\.viewport\.z\) \* slopeAlong\(p, vec2i\(1, 0\), centre\)/);
  assert.match(GUIDE_WGSL, /abs\(view\.viewport\.w\) \* slopeAlong\(p, vec2i\(0, 1\), centre\)/);
});
