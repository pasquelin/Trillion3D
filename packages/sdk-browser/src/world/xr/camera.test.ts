import test from 'node:test';
import assert from 'node:assert/strict';
import { createXrCamera } from './camera.ts';
import { createEngineCamera, readCameraWorld } from '../../camera/world.ts';
import { transform } from './session.fixture.ts';

test('each asymmetric headset lens retains its exact screen projection and eye pose', () => {
  for (const [eye, offset] of [
    ['left', -0.12],
    ['right', 0.16],
  ] as const) {
    const projection = new Float32Array([
      1.4,
      0,
      0,
      0,
      0,
      1.9,
      0,
      0,
      offset,
      0.03,
      -1.002002,
      -1,
      0,
      0,
      -0.2002002,
      0,
    ]);
    const host = createXrCamera().update(
      { eye, projectionMatrix: projection, transform: transform(offset) },
      1200,
      1100,
    );
    assert.deepEqual([...host.projectionMatrix.elements], [...projection]);
    const engine = readCameraWorld(createEngineCamera(), host, 1200 / 1100);
    for (const at of [0, 5, 8, 9])
      assert.ok(Math.abs(engine.projection[at] - projection[at]) < 1e-12);
    assert.equal(engine.eye[0], offset);
    assert.ok(engine.near > 0.099 && engine.near < 0.101);
    assert.ok(engine.far > 99 && engine.far < 101);
  }
});

test('WebGPU-compatible XR sessions use the specified zero-to-one depth range', () => {
  const projection = new Float32Array([
    1.4,
    0,
    0,
    0,
    0,
    1.9,
    0,
    0,
    0.12,
    -0.07,
    -100 / 99.9,
    -1,
    0,
    0,
    -10 / 99.9,
    0,
  ]);
  const host = createXrCamera().update(
    { eye: 'right', projectionMatrix: projection, transform: transform(0.03) },
    1200,
    1100,
    true,
  );
  const engine = readCameraWorld(createEngineCamera(), host, 1200 / 1100);
  assert.ok(Math.abs(engine.near - 0.1) < 1e-7);
  assert.ok(Math.abs(engine.far - 100) < 0.001);
  for (const at of [0, 5, 8, 9])
    assert.ok(Math.abs(engine.projection[at] - projection[at]) < 1e-12);
});
