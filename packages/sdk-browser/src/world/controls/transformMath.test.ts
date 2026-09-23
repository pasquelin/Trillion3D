import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts';
import { Ray } from '../../../../sdk-core/src/world/math/volumes.ts';
import { dragTransform, type DragStart, type TransformHandle } from './transformMath.ts';

const close = (a: Vector3, b: readonly number[]) =>
  a.toArray().every((value, i) => Math.abs(value - b[i]) < 1e-9);
/** An object at the origin turned a quarter about `y`: its own `x` is the world's `-z`. */
const turned = () => new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
/** Rays looking down `-x` onto the plane `x = 0`, through `(0, y, z)`. */
const along = (y: number, z: number) => new Ray(new Vector3(10, y, z), new Vector3(-1, 0, 0));
const start = (mode: DragStart['mode'], handle: TransformHandle, space: DragStart['space']) => ({
  mode,
  handle,
  space,
  position: new Vector3(),
  quaternion: turned(),
  scale: new Vector3(1, 1, 1),
  view: new Vector3(-1, 0, 0),
  from: along(0, -1),
  up: new Vector3(0, 1, 0),
  reach: 1,
});

test('a translation follows the handle axis: the object own in local space, the world in world', () => {
  const local = dragTransform(start('translate', 'x', 'local'), along(0, -3))!;
  assert.ok(close(local.position, [0, 0, -2]), 'local x is the world -z');
  const world = dragTransform(start('translate', 'y', 'world'), along(1.2, -1), {
    translate: 0.5,
  })!;
  assert.ok(close(world.position, [0, 1, 0]), 'world y, rounded to half units');
});

test('a turn is read on the ring plane and rounded to the angle step', () => {
  // The object's own x is the world's -z: its ring lies in the plane z = 0, seen down -z.
  const down = (x: number, y: number) => new Ray(new Vector3(x, y, 10), new Vector3(0, 0, -1));
  const s = { ...start('rotate', 'x', 'local'), from: down(1, 0) };
  const drag = (to: Ray, step?: number) => dragTransform(s, to, { rotate: step })!.quaternion;
  const quarter = drag(down(0, 1));
  assert.ok(close(new Vector3(0, 0, 1).applyQuaternion(quarter), [0, 1, 0]));
  const snapped = drag(down(Math.cos(0.9), Math.sin(0.9)), Math.PI / 4);
  assert.ok(Math.abs(snapped.angleTo(turned()) - Math.PI / 4) < 1e-9, '0.9 rad rounds to π/4');
});

test('a scale acts along the object own axis, factor from the drag, rounded to its step', () => {
  const axis = dragTransform(start('scale', 'x', 'world'), along(0, -3))!;
  assert.ok(close(axis.scale, [3, 1, 1]), 'scale is always local: x is the world -z here');
  const snapped = dragTransform(start('scale', 'x', 'world'), along(0, -2.2), { scale: 0.5 })!;
  assert.equal(snapped.scale.x, 2);
});

test('a uniform scale reads the drag up the screen, wherever the centre was pressed', () => {
  const from = (y: number, z: number) => ({ ...start('scale', 'xyz', 'world'), from: along(y, z) });
  const centre = dragTransform(from(0, 0), along(1, 0))!,
    corner = dragTransform(from(0.2, 0.3), along(1.2, 0.3))!;
  assert.ok(close(centre.scale, [Math.E, Math.E, Math.E]), 'up by the handle length: × e');
  assert.ok(close(corner.scale, centre.scale.toArray()), 'the press point does not matter');
});
