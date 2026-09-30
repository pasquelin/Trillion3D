import test from 'node:test';
import assert from 'node:assert/strict';
import { namedMove } from './worldSceneMethods.ts';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

test('a move by name asks a frame only when the node moved', () => {
  const scene = new Object3D(),
    node = new Object3D();
  node.name = 'door';
  scene.add(node);
  scene.updateMatrixWorld(true);
  const moved: Object3D[] = [];
  let frames = 0;
  const move = namedMove(scene, { moved: (n) => moved.push(n) }, () => frames++);
  const at = (x: number) => Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]);
  move('door', at(2));
  assert.deepEqual([moved, frames], [[node], 1], 'a real move marks the node and asks a frame');
  move('door', at(2));
  assert.deepEqual([moved.length, frames], [1, 1], 'the same pose again asks nothing');
});
