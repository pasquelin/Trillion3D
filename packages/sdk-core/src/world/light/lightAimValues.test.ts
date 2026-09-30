import test from 'node:test';
import assert from 'node:assert/strict';
import { Light } from './light.ts';
import { Group } from '../object/object3d.ts';
import { countingLink } from '../object/sceneLink.fixture.ts';
import { near } from '../../math/near.fixture.ts';

test('lookAt accepts numbers and vectors, turning the emitter and moving its target in world space', () => {
  for (const parented of [false, true]) {
    const lamp = new Light('rectArea', { position: [1, 2, 3] });
    if (parented) {
      const parent = new Group();
      parent.position.set(10, -5, 2);
      parent.rotation.z = Math.PI / 2;
      parent.scale.set(2, 2, 2);
      parent.add(lamp.target);
    }
    lamp.lookAt(4, 6, 3);
    near(lamp.target.getWorldPosition().toArray(), [4, 6, 3], 'numeric target');
    near(lamp.getWorldDirection().toArray(), [0.6, 0.8, 0], 'numeric facing');
    lamp.lookAt({ x: 1, y: 2, z: -2 });
    near(lamp.target.getWorldPosition().toArray(), [1, 2, -2], 'vector target');
    near(lamp.getWorldDirection().toArray(), [0, 0, -1], 'vector facing');
  }
});

test('needsUpdate publishes edited probe coefficients while remaining a write-only invalidation', () => {
  const lamp = new Light('probe', { sh: Array(27).fill(0) });
  lamp.needsUpdate = true;
  assert.equal(lamp.needsUpdate, false);
  const scene = new Group();
  const { link, heard } = countingLink();
  scene._link = link;
  scene.add(lamp);
  heard.length = 0;
  lamp.sh![3] = 2;
  lamp.needsUpdate = true;
  assert.deepEqual(heard, [lamp]);
  assert.equal(lamp.needsUpdate, false);
  scene.remove(lamp);
  heard.length = 0;
  lamp.needsUpdate = true;
  assert.deepEqual(heard, []);
});
