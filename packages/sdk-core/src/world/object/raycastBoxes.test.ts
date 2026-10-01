import test from 'node:test';
import assert from 'node:assert/strict';
import { raycast } from './index.ts';
import { Ray } from '../math/volumes.ts';
import { Vector3 } from '../math/vector3.ts';
import { Box3 } from '../math/box3.ts';
import { Object3D } from './object3d.ts';

class Boxed extends Object3D {
  override localBounds() {
    return new Box3(new Vector3(2, 3, 4), new Vector3(6, 9, 12));
  }
}
const close = (actual: number[], expected: number[]) =>
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-10));

test('all six box faces return outward normals, world positions and scaled distances', () => {
  const box = new Boxed();
  box.position.set(10, 20, 30);
  box.scale.set(2, 3, 4);
  const center = [18, 38, 62],
    low = [14, 29, 46],
    high = [22, 47, 78];
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const origin = [...center],
        expected = [...center],
        normal = [0, 0, 0],
        direction = [0, 0, 0];
      expected[axis] = sign < 0 ? low[axis] : high[axis];
      origin[axis] = expected[axis] + sign * 7;
      normal[axis] = sign;
      direction[axis] = -sign * 5;
      const [hit] = raycast(
        box,
        new Ray(
          new Vector3(...(origin as [number, number, number])),
          new Vector3(...(direction as [number, number, number])),
        ),
      );
      assert.equal(hit.object, box);
      assert.equal(hit.face, -1);
      close(hit.normal.toArray(), normal);
      close(hit.point.toArray(), expected);
      assert.ok(Math.abs(hit.distance - 7) < 1e-10);
    }
});

test('box corners choose the first equally close face and inside hits keep a zero distance', () => {
  const box = new Boxed();
  const [edge] = raycast(box, new Ray(new Vector3(0, 1, 8), new Vector3(1, 1, 0)));
  close(edge.point.toArray(), [2, 3, 8]);
  close(edge.normal.toArray(), [-1, 0, 0]);
  const [inside] = raycast(box, new Ray(new Vector3(4, 6, 8), new Vector3(0, 0, 3)));
  assert.equal(inside.face, -1);
  assert.equal(inside.distance, 0);
  close(inside.normal.toArray(), [0, 0, -1]);
  close(inside.point.toArray(), [4, 6, 8]);
});

test('ray hits sort independently of root order and custom skip omits a whole subtree', () => {
  const near = new Boxed(),
    far = new Boxed(),
    middle = new Boxed(),
    parent = new Object3D();
  far.position.x = 20;
  middle.position.x = 10;
  parent.add(middle);
  const ray = new Ray(new Vector3(0, 6, 8), new Vector3(2, 0, 0));
  const hits = raycast([far, parent, near], ray);
  assert.deepEqual(
    hits.map((h) => h.object),
    [near, middle, far],
  );
  assert.deepEqual(
    hits.map((h) => h.distance),
    [2, 12, 22],
  );
  assert.deepEqual(
    raycast([far, parent, near], ray, (node) => node === parent).map((h) => h.object),
    [near, far],
  );
  assert.deepEqual(raycast(new Object3D(), ray), []);
});

test('ray queries leave pending matrices of excluded descendants untouched', () => {
  for (const hidden of [false, true]) {
    const root = new Boxed(),
      child = new Object3D();
    root.add(child);
    root.updateWorldMatrix(true, true);
    const previous = [...child.worldMatrix];
    child.position.set(10, 20, 30);
    child.visible = !hidden;
    const hits = raycast(
      root,
      new Ray(new Vector3(4, 6, 20), new Vector3(0, 0, -1)),
      (node) => !hidden && node === child,
    );
    assert.equal(hits.length, 1);
    assert.deepEqual([...child.worldMatrix], previous);
    child.updateWorldMatrix(true, false);
    assert.deepEqual([...child.worldMatrix].slice(12, 15), [10, 20, 30]);
  }
});
