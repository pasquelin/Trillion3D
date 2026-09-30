import test from 'node:test';
import assert from 'node:assert/strict';
import { Light } from './light.ts';
import { Object3D } from '../object/object3d.ts';

test('copying a light includes independently owned children unless recursion is disabled', () => {
  const source = new Light('spot');
  const child = new Object3D();
  child.name = 'emitter housing';
  child.position.set(2, 3, 4);
  source.add(child);
  const copy = new Light('point').copy(source);
  assert.equal(copy.children.length, 1);
  assert.notEqual(copy.children[0], child);
  assert.equal(copy.children[0].name, 'emitter housing');
  assert.deepEqual(copy.children[0].position.toArray(), [2, 3, 4]);
  assert.equal(copy.children[0].parent, copy);
  assert.equal(child.parent, source);
  assert.equal(new Light('point').copy(source, false).children.length, 0);
});
