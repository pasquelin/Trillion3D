import assert from 'node:assert/strict';
import test from 'node:test';
import { smokeCamera } from '../inputs.ts';
import { Matrix4 } from '../../../../packages/sdk-core/src/world/math/matrix4.ts';
import { Vector3 } from '../../../../packages/sdk-core/src/world/math/vector3.ts';

test('SDK clip near -1 starts in front of the smoke and exact orthographic coverage reaches its edges', () => {
  const camera = smokeCamera();
  const inverse = new Matrix4().fromArray(camera.inverseViewProjection);
  const near = new Vector3(0, 0, -1).applyMatrix4(inverse);
  const far = new Vector3(0, 0, 1).applyMatrix4(inverse);
  assert.ok(Math.abs(near.z - 1.9) < 1e-6);
  assert.ok(Math.abs(far.z + 8) < 1e-6);
  assert.ok(near.z > 0.5 && far.z < -0.5);
  for (const coverage of [0.0625, 0.25, 0.5, 1]) {
    const half = Math.sqrt(coverage);
    const corner = new Vector3(half, half, -1).applyMatrix4(inverse);
    assert.ok(Math.abs(corner.x - half) < 1e-6);
    assert.ok(Math.abs(corner.y - half) < 1e-6);
    assert.ok(Math.abs(corner.x * corner.y - coverage) < 1e-6);
  }
});
