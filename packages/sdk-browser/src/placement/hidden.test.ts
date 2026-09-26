// #787: a host visibility change hands back the union box of the roots that flipped, or `null`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { ClusterRoot } from '../page/selection/types.ts';
import { followHostVisibility } from './hidden.ts';

const BOXES = Float64Array.of(0, 0, 0, 1, 1, 1, -2, 3, 0, -1, 4, 5, 9, 9, 9, 10, 10, 10);

test('followHostVisibility: null while no root flips, the flipped roots union once one does', () => {
  const [a, b, c] = [new Object3D(), new Object3D(), new Object3D()];
  // Each stands for a mesh, which casts unless set otherwise (#456).
  for (const node of [a, b, c]) node.castShadow = true;
  const roots = [a, b, c].map((sourceMesh, i) => ({
    pages: [{ sourceMesh }],
    worldBox: BOXES.subarray(i * 6, i * 6 + 6),
  })) as unknown as ClusterRoot<{ sourceMesh: Object3D }>[];
  const parked: [number, boolean][] = [];
  const none = { entries: [], sourceOf: () => undefined };
  const follow = () =>
    followHostVisibility(roots, none, (rank, root) => parked.push([rank, !!root.parked]));
  assert.equal(follow(), null);
  a.visible = false;
  b.visible = false;
  const moved = follow();
  assert.deepEqual([...moved!.min], [-2, 0, 0]);
  assert.deepEqual([...moved!.max], [1, 4, 5]);
  assert.deepEqual(parked.flat(), [0, true, 1, true]);
  assert.equal(follow(), null, 'no flip since');
  b.visible = true;
  assert.deepEqual([...follow()!.max], [-1, 4, 5]);
});
