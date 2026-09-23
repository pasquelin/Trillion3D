import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from './object3d.ts';

// Re-deriving Euler angles from the quaternion would swap (0, y, 0) past ±90° for the equivalent
// (π, π − y, π); a later one-axis write would then keep x = z = π and turn the node another way.
test('angles written stay as written past ±90°, and a one-axis write turns only that axis', () => {
  const node = new Object3D();
  node.rotation.y = 2.7;
  assert.deepEqual([node.rotation.x, node.rotation.y, node.rotation.z], [0, 2.7, 0]);
  node.rotation.y = 2.8;
  const q = node.quaternion;
  assert.ok(Math.abs(q.x) < 1e-12 && Math.abs(q.z) < 1e-12, 'a pure turn about Y');
  assert.ok(Math.abs(Math.abs(q.y) - Math.sin(1.4)) < 1e-12);
});

test('a quaternion write still sets the angles it implies', () => {
  const node = new Object3D();
  node.quaternion.set(0, Math.sin(0.5), 0, Math.cos(0.5));
  assert.ok(Math.abs(node.rotation.y - 1) < 1e-12);
});
