import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeformationSkip } from './screen.ts';
import { createEngineCamera } from '../camera/world.ts';
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts';
import type { ClusterRoot, PageRec } from '../page/selection/selection.ts';

test('orthographic deformation remains visible at any depth', () => {
  const camera = createEngineCamera();
  camera.view.set(new Matrix4().elements);
  camera.projection.set(new Matrix4().elements);
  camera.perspective = 0;
  camera.near = 0.1;
  const root = {
    world: new Matrix4(),
    worldBox: new Float64Array([-1, -1, -1001, 1, 1, -999]),
  } as ClusterRoot<PageRec>;
  const skip = createDeformationSkip()([root], camera, [1000, 1000], 1);
  assert.equal(skip(0, 0.1), false, '50 pixel displacement cannot be skipped');
  assert.equal(skip(0, 0.001), true, 'subpixel displacement can be skipped');
});

test('off-axis depth motion uses the existing conservative projected-error bound', () => {
  const camera = createEngineCamera();
  camera.view.set(new Matrix4().elements);
  camera.projection.set(new Matrix4().elements);
  camera.perspective = 1;
  camera.near = 0.1;
  const root = {
    world: new Matrix4(),
    worldBox: new Float64Array([10, 0, -10, 10, 0, -10]),
  } as ClusterRoot<PageRec>;
  const skip = createDeformationSkip()([root], camera, [1000, 1000], 0.45);
  const actualDepthMotion = 500 * (10 / (10 - 0.01) - 1);
  assert.ok(actualDepthMotion > 0.45);
  assert.equal(skip(0, 0.01), false);
});
