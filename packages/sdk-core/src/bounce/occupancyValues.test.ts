import test from 'node:test';
import assert from 'node:assert/strict';
import { createBounceCascades } from './cascades.ts';
import { createBounceOccupancy } from './occupancy.ts';
import { ownedProxy } from '../scene/core/proxy.fixture.ts';

function maps(empty = false) {
  const proxy = ownedProxy();
  proxy.bounds = [0, 0, 0, 8, 8, 8];
  if (empty) proxy.data.triangles = new Float32Array();
  const cascades = createBounceCascades(proxy.bounds);
  cascades.levels = [
    { spacing: 1, base: [0, 0, 0], moving: false },
    { spacing: 2, base: [0, 0, 0], moving: false },
  ];
  return { proxy, cascades, occupancy: createBounceOccupancy(proxy, cascades) };
}

test('triangle occupancy and its coarse reduction retain the interpolation boundary on every axis', () => {
  const { occupancy } = maps();
  let fine = 0;
  for (let z = -4; z <= 12; z++)
    for (let y = -4; y <= 12; y++)
      for (let x = -4; x <= 12; x++) {
        const expected = x >= -1 && x <= 2 && y >= -1 && y <= 2 && z >= -1 && z <= 1;
        assert.equal(occupancy.occupied(0, x, y, z), expected, `fine ${x},${y},${z}`);
        if (expected) fine++;
        const coarse = x >= -1 && x <= 2 && y >= -1 && y <= 2 && z >= -1 && z <= 1;
        assert.equal(occupancy.occupied(1, x, y, z), coarse, `coarse ${x},${y},${z}`);
        assert.equal(occupancy.occupied(8, x, y, z), coarse);
      }
  assert.equal(occupancy.marked, fine);
  assert.ok(occupancy.cells >= fine);
  assert.ok(occupancy.bytes > occupancy.cells);
  const empty = maps(true).occupancy;
  assert.equal(empty.marked, 0);
  for (const point of [
    [0, 0, 0],
    [-100, 0, 0],
    [0, 100, 0],
    [0, 0, 100],
  ])
    assert.equal(empty.occupied(0, point[0], point[1], point[2]), false);
});

test('unchanged owners keep occupancy while changed owners join once and settle to exact geometry', () => {
  const { occupancy, proxy } = maps();
  const boxes = [3, 4, 5, 3, 4, 5];
  const original = occupancy.marked;
  occupancy.moved(boxes, [0]);
  assert.equal(occupancy.marked, original);
  assert.equal(occupancy.occupied(0, 3, 4, 5), false);
  occupancy.moved(boxes, [1]);
  assert.equal(occupancy.occupied(0, 3, 4, 5), true);
  const marked = occupancy.marked;
  assert.ok(marked > original);
  assert.equal(marked, original + 27);
  for (const point of [
    [2, 3, 4],
    [4, 5, 6],
    [2, 5, 4],
  ])
    assert.equal(occupancy.occupied(0, point[0], point[1], point[2]), true);
  occupancy.moved(boxes, [1]);
  assert.equal(occupancy.marked, marked);
  occupancy.settle(boxes, proxy.bounds);
  assert.equal(occupancy.marked, marked);
  occupancy.settle(boxes, proxy.bounds);
  assert.equal(occupancy.marked, 27);
  assert.equal(occupancy.occupied(0, 0, 0, 0), false);
  assert.equal(occupancy.occupied(0, 3, 4, 5), true);
  occupancy.settle([0, 0, 0, 0, 0, 0], proxy.bounds);
  assert.equal(occupancy.occupied(0, 3, 4, 5), true, 'idle settle never rebuilds again');
});

test('motion addresses each triangle and translated lattices preserve occupied global cells', () => {
  const { occupancy, proxy, cascades } = maps();
  occupancy.moved([0, 0, 0, 0, 0, 0, 5, 6, 7, 5, 6, 7], [0, 1]);
  assert.equal(occupancy.occupied(0, 5, 6, 7), true);
  assert.equal(occupancy.occupied(0, 4, 5, 6), true);
  cascades.levels.pop();
  occupancy.moved([0, 0, 0, 0, 0, 0], [0]);
  assert.equal(occupancy.occupied(0, 1000, 0, 0), true);
  const shifted = ownedProxy();
  shifted.bounds = [10, 20, 30, 26, 36, 46];
  shifted.data.triangles = new Float32Array([10, 20, 30, 12, 20, 30, 10, 22, 30]);
  const plan = createBounceCascades(shifted.bounds);
  plan.levels = [
    { spacing: 2, base: [0, 0, 0], moving: false },
    { spacing: 4, base: [0, 0, 0], moving: false },
  ];
  const moved = createBounceOccupancy(shifted, plan);
  assert.equal(moved.occupied(0, 5, 10, 15), true);
  assert.equal(moved.occupied(1, 2, 5, 7), true);
  assert.equal(moved.occupied(0, 0, 0, 0), false);
  occupancy.settle([0, 0, 0, 0, 0, 0], proxy.bounds);
});

test('movement outside any map axis stays conservative until the next quiet frame', () => {
  for (const axis of [0, 1, 2])
    for (const coordinate of [-20, 20]) {
      const { occupancy, proxy } = maps();
      const box = [0, 0, 0, 0, 0, 0];
      box[axis] = box[axis + 3] = coordinate;
      occupancy.moved(box, [1]);
      assert.equal(occupancy.occupied(0, 1000, 1000, 1000), true);
      occupancy.settle(box, proxy.bounds);
      occupancy.settle(box, proxy.bounds);
      assert.equal(occupancy.occupied(0, 1000, 1000, 1000), false);
    }
  const { occupancy, cascades, proxy } = maps();
  cascades.levels[0].spacing = 2;
  occupancy.moved([0, 0, 0, 1, 1, 0], [0]);
  assert.equal(occupancy.occupied(0, 1000, 0, 0), true);
  occupancy.settle([0, 0, 0, 1, 1, 0], proxy.bounds);
  occupancy.settle([0, 0, 0, 1, 1, 0], proxy.bounds);
  assert.equal(occupancy.occupied(0, 1000, 0, 0), false);
});
