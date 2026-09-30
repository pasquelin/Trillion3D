import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from './object3d.ts';
import { Matrix4 } from '../math/matrix4.ts';
import { Vector3 } from '../math/vector3.ts';

const near = (actual: Vector3, expected: number[]) => {
  actual.toArray().forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12));
};

test('axis rotation helpers turn the local basis and translation follows the turned axis', () => {
  for (const [axis, expected] of [
    ['X', [0, -1, 0]],
    ['Y', [1, 0, 0]],
    ['Z', [0, 0, 1]],
  ] as const) {
    const node = new Object3D();
    assert.equal(node[`rotate${axis}`](Math.PI / 2), node);
    near(node.getWorldDirection(), [...expected]);
  }
  const node = new Object3D();
  assert.equal(node.rotateOnAxis(new Vector3(0, 0, 1), Math.PI / 2), node);
  assert.equal(node.translateOnAxis(new Vector3(1, 0, 0), 3), node);
  near(node.position, [0, 3, 0]);
  near(node.getWorldPosition(), [0, 3, 0]);
});

test('numeric and vector lookAt both update the readable quaternion and world direction', () => {
  const node = new Object3D();
  node.position.set(1, 2, 3);
  node.lookAt(6, 2, 3);
  near(node.getWorldDirection(), [1, 0, 0]);
  near(new Vector3(0, 0, 1).applyQuaternion(node.quaternion), [1, 0, 0]);
  node.lookAt(new Vector3(-4, 2, 3));
  near(node.getWorldDirection(), [-1, 0, 0]);
  near(new Vector3(0, 0, 1).applyQuaternion(node.quaternion), [-1, 0, 0]);
});

test('applyMatrix4 uses the current pose in automatic mode and the authored matrix in manual mode', () => {
  const automatic = new Object3D();
  automatic.position.set(2, 3, 4);
  automatic.applyMatrix4(new Matrix4().makeScale(2, 3, 4));
  near(automatic.position, [4, 9, 16]);
  near(automatic.scale, [2, 3, 4]);
  const manual = new Object3D();
  manual.matrixAutoUpdate = false;
  manual.matrix.makeTranslation(5, 6, 7);
  manual.position.set(100, 100, 100);
  manual.applyMatrix4(new Matrix4().makeTranslation(1, 2, 3));
  near(manual.position, [6, 8, 10]);
});
