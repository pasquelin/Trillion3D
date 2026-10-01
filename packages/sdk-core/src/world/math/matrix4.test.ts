import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix3, Matrix4 } from './matrix4.ts';
import { Vector3 } from './vector3.ts';
import { Quaternion } from './quaternion.ts';
import { near as within } from '../../math/near.fixture.ts';

const close = (actual: ArrayLike<number>, expected: ArrayLike<number>) =>
  within(actual, Array.from(expected), 'matrix', 1e-10);

test('matrix storage, transpose and copying preserve all sixteen independent entries', () => {
  const row = new Matrix4().set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
  assert.deepEqual(row.toArray(), [1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15, 4, 8, 12, 16]);
  const copied = new Matrix4().fromArray([99, ...row.toArray(), 98], 1);
  assert.ok(copied.equals(row));
  assert.notEqual(copied.elements, row.elements);
  assert.deepEqual(
    row.clone().transpose().toArray(),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  );
  assert.ok(row.clone().transpose().transpose().equals(row));
  copied.setPosition(21, 22, 23);
  assert.equal(row.elements[12], 4);
  for (let i = 0; i < 16; i++) {
    const different = row.clone();
    different.elements[i]++;
    assert.equal(different.equals(row), false);
  }
  assert.ok(copied.identity().equals(new Matrix4()));
});

test('composition and decomposition recover independently specified poses and mirrored scale', () => {
  const position = new Vector3(7, -11, 13);
  const turn = new Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2);
  for (const scale of [new Vector3(2, 3, 4), new Vector3(-2, 3, 4)]) {
    const matrix = new Matrix4().compose(position, turn, scale);
    const p = new Vector3(),
      q = new Quaternion(),
      s = new Vector3();
    assert.equal(matrix.decompose(p, q, s), matrix);
    close(p.toArray(), position.toArray());
    close(s.toArray(), scale.toArray());
    close(new Matrix4().compose(p, q, s).elements, matrix.elements);
    close(matrix.clone().multiply(matrix.clone().invert()).elements, new Matrix4().elements);
    assert.ok(Math.abs(matrix.determinant() - (scale.x < 0 ? -24 : 24)) < 1e-10);
    assert.ok(Math.abs(matrix.getMaxScaleOnAxis() - 4) < 1e-10);
    close(
      new Vector3(1, 2, 3).applyMatrix4(matrix).applyMatrix4(matrix.clone().invert()).toArray(),
      [1, 2, 3],
    );
  }
});

test('multiplication order changes the position and cardinal rotations orient each axis', () => {
  const move = new Matrix4().makeTranslation(3, 5, 7),
    scale = new Matrix4().makeScale(2, 3, 4);
  assert.deepEqual(
    new Vector3(1, 2, 3).applyMatrix4(move.clone().multiply(scale)).toArray(),
    [5, 11, 19],
  );
  assert.deepEqual(
    new Vector3(1, 2, 3).applyMatrix4(move.clone().premultiply(scale)).toArray(),
    [8, 21, 40],
  );
  const fixtures = [
    [new Matrix4().makeRotationX(Math.PI / 2), [0, 1, 0], [0, 0, 1]],
    [new Matrix4().makeRotationY(Math.PI / 2), [0, 0, 1], [1, 0, 0]],
    [new Matrix4().makeRotationZ(Math.PI / 2), [1, 0, 0], [0, 1, 0]],
  ] as const;
  for (const [matrix, point, expected] of fixtures)
    close(new Vector3(...point).applyMatrix4(matrix).toArray(), expected);
  close(
    new Matrix4().makeRotationAxis({ x: 0, y: 0, z: 7 }, Math.PI / 2).elements,
    fixtures[2][0].elements,
  );
  close(
    new Matrix4().makeRotationFromQuaternion(new Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2))
      .elements,
    fixtures[2][0].elements,
  );
  for (const magnitudes of [
    [7, 2, 3],
    [2, 7, 3],
    [2, 3, 7],
  ])
    assert.equal(
      new Matrix4().makeScale(magnitudes[0], magnitudes[1], magnitudes[2]).getMaxScaleOnAxis(),
      7,
    );
});

test('linear and normal matrices preserve directions under a nonuniform affine transform', () => {
  const affine = new Matrix4().makeScale(2, 4, 8).setPosition(7, 11, 13);
  const linear = new Matrix3().setFromMatrix4(affine);
  assert.deepEqual(linear.toArray(), [2, 0, 0, 0, 4, 0, 0, 0, 8]);
  const normal = new Matrix3().getNormalMatrix(affine);
  close(normal.elements, [0.5, 0, 0, 0, 0.25, 0, 0, 0, 0.125]);
  const source = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
  assert.deepEqual(source.toArray(), [1, 4, 7, 2, 5, 8, 3, 6, 9]);
  const copy = source.clone();
  assert.notEqual(copy.elements, source.elements);
  assert.deepEqual(copy.toArray(), source.toArray());
  assert.deepEqual(copy.identity().toArray(), new Matrix3().toArray());
});
