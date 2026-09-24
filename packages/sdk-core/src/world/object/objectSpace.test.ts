import test from 'node:test';
import assert from 'node:assert/strict';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { Object3D } from './object3d.ts';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/** Collects until `done`, or for `rounds` rounds, letting the finalizers run in between. */
async function collect(done: () => boolean, rounds = 50) {
  for (let round = 0; round < rounds && !done(); round++) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function dropTrees(count: number) {
  for (let i = 0; i < count; i++) new Object3D().add(new Object3D());
}

test('a dropped object frees its slot: the space stops growing', async () => {
  const tree = Object3D._treeOf(new Object3D());
  dropTrees(500);
  const end = tree.end;
  await collect(() => tree.freeCount >= 1000);
  assert.ok(tree.freeCount >= 1000, `${tree.freeCount} slots freed of 1000 dropped`);
  dropTrees(500);
  assert.equal(tree.end, end, 'the new objects took the freed slots');
});

test('a destroyed object is freed once, never again when it is collected', async () => {
  const tree = Object3D._treeOf(new Object3D());
  await collect(() => false, 5);
  (() => new Object3D().destroy())();
  await collect(() => false, 5);
  const free = [...tree.free.subarray(0, tree.freeCount)];
  assert.equal(new Set(free).size, free.length, 'no slot is on the free list twice');
});

test('a matrix handed out keeps its object: its slot is never given to another', async () => {
  const tree = Object3D._treeOf(new Object3D());
  const [world, local] = (() => {
    const held = new Object3D();
    held.position.set(7, 8, 9);
    held.updateMatrixWorld();
    return [held.matrixWorld, held.matrix];
  })();
  const free = tree.freeCount;
  dropTrees(200);
  await collect(() => tree.freeCount >= free + 400);
  const others = Array.from({ length: 400 }, () => new Object3D());
  assert.deepEqual([...world.elements.slice(12, 15)], [7, 8, 9], 'no other object reads here');
  local.elements[12] = 100;
  for (const other of others) assert.equal(other.matrix.elements[12], 0, 'no other object moved');
});
