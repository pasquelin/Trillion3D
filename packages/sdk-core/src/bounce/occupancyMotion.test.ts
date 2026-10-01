import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertMap,
  cellsAround,
  gap,
  occupiedAt,
  point,
  scene,
  type Box,
} from './occupancy.fixture.ts';

test('moved owners join at once, as a fresh map of both poses would hold them', () => {
  const bounds = [0, 0, 0, 20, 3, 3],
    still: Box = [6, 1, 1, 7.5, 2, 1];
  for (const target of [
    point([3, 2.5, 2]),
    point([20, 0, 3]),
    point([0, 3, 0]),
    [9, 0, 0, 12, 3, 3],
  ]) {
    const { occupancy, cascades } = scene(bounds, [still]);
    occupancy.moved([...target], [0]);
    assertMap(occupancy, cascades, bounds, [still], 'an unchanged owner adds nothing');
    occupancy.moved([...target], [1]);
    assertMap(occupancy, cascades, bounds, [still, target], `${target}`);
    occupancy.moved([...target], [1]);
    assertMap(occupancy, cascades, bounds, [still, target], `${target} twice`);
  }
  // Each changed owner reads its own six bounds.
  const { occupancy, cascades } = scene(bounds, [still]);
  const second = point([15, 1, 2]);
  occupancy.moved([...point([1, 1, 1]), ...second], [0, 1]);
  assertMap(occupancy, cascades, bounds, [still, second], 'second owner');
});

test('the first frame after motion rebuilds the exact map of the new poses, once', () => {
  const bounds = [0, 0, 0, 20, 3, 3],
    from: Box = [6, 1, 1, 7.5, 2, 1],
    to = point([15, 1, 2]);
  const { occupancy, cascades } = scene(bounds, [from]);
  occupancy.moved([...to], [1]);
  occupancy.settle([...to], bounds);
  assertMap(occupancy, cascades, bounds, [from, to], 'a frame that moved does not rebuild');
  occupancy.settle([...to], bounds);
  assertMap(occupancy, cascades, bounds, [to], 'the first still frame rebuilds');
  occupancy.settle([...from], bounds);
  assertMap(occupancy, cascades, bounds, [to], 'later still frames keep it');
  const idle = scene(bounds, [from]);
  idle.occupancy.settle([...to], bounds);
  idle.occupancy.settle([...to], bounds);
  assertMap(idle.occupancy, idle.cascades, bounds, [from], 'no motion, no rebuild');
});

test('geometry moved off the map keeps every cell until it settles, on any axis', () => {
  const bounds = [0, 0, 0, 20, 3, 3];
  for (let axis = 0; axis < 3; axis++)
    for (const side of [-1, 1]) {
      const { occupancy, cascades } = scene(bounds, [point([5, 1, 1])]);
      const far = [5, 1, 1];
      far[axis] = side < 0 ? -50 : 50 + bounds[3 + axis];
      occupancy.moved([...point(far)], [1]);
      for (let level = 0; level < cascades.levels.length; level++)
        assert.ok(occupancy.occupied(level, 1e5, -1e5, 1e5), `${axis} ${side}: every cell`);
      const grown = [...bounds];
      if (side < 0) grown[axis] = far[axis];
      else grown[3 + axis] = far[axis];
      occupancy.settle([...point(far)], grown);
      occupancy.settle([...point(far)], grown);
      assertMap(occupancy, cascades, grown, [point(far)], `${axis} ${side}: settled`);
    }
});

test('geometry moved up to the edges of the map joins it alone, without wrapping a row', () => {
  const bounds = [0, 0, 0, 20, 3, 3];
  const { cascades } = scene(bounds, []);
  const spacing = cascades.levels[0].spacing;
  /** The occupancy after one owner moved to the middle of `cell` on `axis`, or null if refused. */
  const movedTo = (axis: number, cell: number) => {
    const { occupancy } = scene(bounds, []);
    const at = [10, 1.5, 1.5];
    at[axis] = (cell + 0.5) * spacing;
    occupancy.moved([...point(at)], [1]);
    return occupancy.occupied(0, 1e5, -1e5, 1e5) ? null : { occupancy, box: point(at) };
  };
  for (let axis = 0; axis < 3; axis++) {
    const faces = [Math.floor(bounds[axis] / spacing), Math.floor(bounds[3 + axis] / spacing)];
    const edges = faces.map((face, side) => {
      const step = side ? 1 : -1;
      let cell = face;
      while (movedTo(axis, cell + step)) cell += step;
      assert.ok(Math.abs(cell - face) >= 1, `${axis}: the map holds a cell beyond each face`);
      return cell;
    });
    for (const edge of edges) {
      const { occupancy, box } = movedTo(axis, edge)!;
      let held = 0;
      const wrong: string[] = [];
      for (const cell of cellsAround(cascades, 0, bounds, 6).cells) {
        const expected =
          gap(cell, box, spacing) <= 1 && cell[axis] >= edges[0] && cell[axis] <= edges[1];
        if (occupiedAt(occupancy, 0, cell) !== expected) wrong.push(`${cell}`);
        if (expected) held++;
      }
      assert.deepEqual(wrong, [], `${axis} at ${edge}`);
      assert.equal(occupancy.marked, held, `${axis} at ${edge}: marked`);
    }
  }
});

test('a new cascade plan schedules every cell until the map is rebuilt on it', () => {
  const bounds = [0, 0, 0, 20, 3, 3],
    box = point([5, 1, 1]);
  // A coarser finest spacing over as many levels, then as fine a spacing over more levels.
  for (const next of [
    [0, 0, 0, 40, 6, 6],
    [0, 0, 0, 60, 3, 3],
  ]) {
    const { occupancy, cascades } = scene(bounds, [box]);
    const before = cascades.levels.map((level) => level.spacing);
    cascades.replan(next);
    const after = cascades.levels.map((level) => level.spacing);
    assert.ok(after[0] !== before[0] || after.length !== before.length, `${next}: ${after}`);
    occupancy.moved([...box], [0]);
    assert.ok(occupancy.occupied(0, 1e5, 0, 0), `${next}: a stale lattice keeps every cell`);
    occupancy.settle([...box], next);
    occupancy.settle([...box], next);
    assertMap(occupancy, cascades, next, [box], `${next}: rebuilt on the new plan`);
  }
});
