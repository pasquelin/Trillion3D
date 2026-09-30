import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from './object3d.ts';
import { raycast } from './raycast.ts';
import { Box3 } from '../math/box3.ts';
import { Vector3 } from '../math/vector3.ts';
import { Ray } from '../math/volumes.ts';

class Boxed extends Object3D {
  override localBounds() {
    return new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
  }
}

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
      new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1)),
      (node) => !hidden && node === child,
    );
    assert.equal(hits.length, 1);
    assert.deepEqual([...child.worldMatrix], previous);
    child.updateWorldMatrix(true, false);
    assert.deepEqual([...child.worldMatrix].slice(12, 15), [10, 20, 30]);
  }
});
