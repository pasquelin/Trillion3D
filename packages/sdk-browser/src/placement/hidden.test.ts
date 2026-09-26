// #787: a host visibility change hands back the box of the roots that flipped, its two corners
// read from one union, or `null` when none flipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { ClusterRoot } from '../page/selection/types.ts';
import { followHostVisibility } from './hidden.ts';

type Page = { sourceMesh?: Object3D };
const rootOf = (node: Object3D, box: number[]) =>
  ({
    world: [],
    pages: [{ sourceMesh: node }],
    worldBox: Float64Array.from(box),
  }) as unknown as ClusterRoot<Page>;

test('followHostVisibility: null while no root flips, the flipped roots union once one does', () => {
  const [a, b, c] = [new Object3D(), new Object3D(), new Object3D()];
  const roots = [
    rootOf(a, [0, 0, 0, 1, 1, 1]),
    rootOf(b, [-2, 3, 0, -1, 4, 5]),
    rootOf(c, [9, 9, 9, 10, 10, 10]),
  ];
  const parked: [number, boolean][] = [];
  const none = { entries: [], sourceOf: () => undefined };
  const follow = () => followHostVisibility(roots, none, (rank, on) => parked.push([rank, on]));
  assert.equal(follow(), null);
  a.visible = false;
  b.visible = false;
  const moved = follow();
  assert.deepEqual([...moved!.min], [-2, 0, 0]);
  assert.deepEqual([...moved!.max], [1, 4, 5]);
  assert.deepEqual(parked, [
    [0, true],
    [1, true],
  ]);
  assert.equal(follow(), null, 'no flip since');
  b.visible = true;
  assert.deepEqual([...follow()!.max], [-1, 4, 5]);
});
