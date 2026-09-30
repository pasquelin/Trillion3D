import test from 'node:test';
import assert from 'node:assert/strict';
import { packSurface, intersectSurface, intersectSphere } from './intersections.ts';

test('surface intersections distinguish tiny forward distances and near-parallel directions', () => {
  const packed = new Float64Array(15);
  packSurface({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] } as any, packed, 0);
  const scratch = new Float64Array(4);
  assert.equal(
    intersectSurface(packed, 0, new Float64Array([0.5, 0.5, 1e-7, 0, 0, -1]), 0, 1, scratch),
    false,
  );
  assert.equal(
    intersectSurface(packed, 0, new Float64Array([0, 0.5, 1e-13, 1, 0, -1e-12]), 0, 1, scratch),
    true,
  );
  assert.ok(Math.abs(scratch[0] - 0.1) < 1e-15);
  assert.equal(
    intersectSurface(packed, 0, new Float64Array([0, 0.5, 5e-14, 1, 0, -5e-13]), 0, 1, scratch),
    false,
  );
  assert.throws(
    () =>
      packSurface(
        { origin: [0, 0, 0], u: [2e-10, 3.162214413982708e-8, 0], v: [0, 0, 1] } as any,
        packed,
        0,
      ),
    (error: any) => error.code === 'INVALID_SCENE',
  );
});

test('sphere rays at the self-intersection tolerance use the far exit and reject tiny exits', () => {
  const ray = new Float64Array([0, 0, 0, 0, 0, 1]);
  const near = {
    sphere: { center: [0, 0, 1.0002910383045673e-7], radius: 2.9103830456733704e-11 },
  } as any;
  assert.ok(Math.abs(intersectSphere(near, ray, 0, 1) - 1.0005820766091346e-7) < 1e-20);
  assert.equal(
    intersectSphere({ sphere: { center: [0, 0, 0], radius: 1e-7 } } as any, ray, 0, 1),
    1,
  );
});
