import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlan } from '../../plan/plan.ts';
import type { Road } from '../../plan/contract.ts';
import { sharedProps, triangleCount, vehicleProps } from '../../props/index.ts';
import { propProblems } from '../../props/validate.ts';
import { inBounds, outputBytes, outputPoints } from '../testing.ts';
import { airportRegion, layout } from './index.ts';
import { corners, inside, overlaps, type Rect } from './rect.ts';

/** The lead's target of unique triangles for a region (the plan's figure is 200 000; see report). */
const TRIANGLE_TARGET = 400_000;
const plan = createPlan(undefined, [airportRegion]),
  { bounds, budget } = plan.regions.airport,
  first = layout(plan),
  { output } = first;

/** Points over a rectangle, no farther apart than `step`. */
function lattice(rect: Rect, step: number): [number, number][] {
  const nx = Math.max(1, Math.ceil((2 * rect.hw) / step)),
    nz = Math.max(1, Math.ceil((2 * rect.hd) / step)),
    [c, s] = [Math.cos(rect.yaw), Math.sin(rect.yaw)],
    points: [number, number][] = [];
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= nz; j++) {
      const a = ((2 * i) / nx - 1) * rect.hw,
        b = ((2 * j) / nz - 1) * rect.hd;
      points.push([rect.x + a * c + b * s, rect.z - a * s + b * c]);
    }
  return points;
}
const within = inBounds(bounds);

test('the airport is byte-identical from one plan', () => {
  assert.ok(outputBytes(airportRegion.generate(plan)).equals(outputBytes(output)));
});

test('everything stands, lights, moves and lands inside the bounds', () => {
  assert.deepEqual(
    outputPoints(output).filter((p) => !within(p)),
    [],
  );
  for (const p of first.placed)
    for (const [x, z] of p.rects.flatMap(corners)) assert.ok(within([x, 0, z]));
});

test('the airport keeps to its node budget and its triangle target', () => {
  const triangles = output.props.reduce((sum, prop) => sum + triangleCount(prop), 0);
  assert.ok(output.instances.length <= budget.nodes, `${output.instances.length} nodes`);
  assert.ok(triangles <= TRIANGLE_TARGET, `${triangles} triangles`);
  assert.ok(triangles > TRIANGLE_TARGET / 2, 'dense enough to show what the engine is for');
});

test('no two solids overlap, no solid or slab lies on a road', () => {
  const solids = first.placed.filter((p) => p.layer !== 'paint' && p.on === undefined);
  const cell = (x: number, z: number) => `${Math.floor(x / 100)},${Math.floor(z / 100)}`,
    grid = new Map<string, number[]>();
  solids.forEach((p, i) => {
    for (const key of new Set(p.rects.flatMap(corners).map(([x, z]) => cell(x, z))))
      grid.set(key, [...(grid.get(key) ?? []), i]);
  });
  for (const [, members] of grid)
    for (let a = 0; a < members.length; a++)
      for (let b = a + 1; b < members.length; b++) {
        const [pa, pb] = [solids[members[a]], solids[members[b]]];
        if (pa.layer !== pb.layer) continue;
        const clash = pa.rects.some((ra) => pb.rects.some((rb) => overlaps(ra, rb)));
        assert.ok(!clash, `${pa.instance.prop} overlaps ${pb.instance.prop}`);
      }
  // Roads, checked directly: no point of a 5 m lattice over a footprint (fine enough to catch
  // any road 8 m wide or more) lies within half a road's width of its centreline.
  const near = (road: Road, x: number, z: number) =>
    road.points.slice(1).some((b, i) => {
      const a = road.points[i],
        [dx, dz] = [b[0] - a[0], b[2] - a[2]],
        k = Math.max(
          0,
          Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1)),
        );
      return Math.hypot(x - a[0] - k * dx, z - a[2] - k * dz) < road.width / 2 - 0.05;
    });
  const boxes = first.roads.map((road) => {
    const xs = road.points.map((p) => p[0]),
      zs = road.points.map((p) => p[2]);
    return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
  });
  for (const p of solids)
    for (const rect of p.rects) {
      const points = lattice(rect, 5),
        reach = Math.hypot(rect.hw, rect.hd);
      first.roads.forEach((road, i) => {
        const [x0, z0, x1, z1] = boxes[i];
        if (
          rect.x < x0 - reach - 50 ||
          rect.x > x1 + reach + 50 ||
          rect.z < z0 - reach - 50 ||
          rect.z > z1 + reach + 50
        )
          return;
        assert.ok(!points.some(([x, z]) => near(road, x, z)), `${p.instance.prop} on ${road.id}`);
      });
    }
});

test('every node stands on the ground, a slab or the node that carries it', () => {
  const pads = first.placed.filter((p) => p.layer === 'pad');
  for (const p of first.placed) {
    if (p.layer === 'paint') continue;
    const [x, y, z] = p.instance.position;
    if (p.on !== undefined) {
      assert.ok(y >= first.placed[p.on].instance.position[1], `${p.instance.prop} under its host`);
      continue;
    }
    const ground = p.rects.flatMap(corners).map(([cx, cz]) => plan.height(cx, cz));
    assert.ok(y >= Math.max(...ground) - 1e-3, `${p.instance.prop} buried at ${x}, ${z}`);
    const onPad = pads.some(
      (pad) =>
        pad !== p &&
        pad.rects.some((r) => inside(r, x, z)) &&
        Math.abs(pad.instance.position[1] - y) < 1e-3,
    );
    assert.ok(
      onPad || p.bottom <= Math.min(...ground) + 0.3,
      `${p.instance.prop} floats at ${x}, ${z}`,
    );
  }
});

test('props are sound, placed by known ids, and the region reads as an airport', () => {
  const own = new Set(output.props.map((p) => p.id)),
    known = new Set([
      ...own,
      ...sharedProps(plan.seed).map((p) => p.id),
      ...vehicleProps().map((p) => p.id),
    ]);
  assert.equal(own.size, output.props.length);
  assert.deepEqual(output.props.flatMap(propProblems), []);
  assert.deepEqual(
    [...new Set(output.instances.map((i) => i.prop))].filter((id) => !known.has(id)),
    [],
  );
  for (const mover of output.movers)
    if ('model' in mover) assert.ok(known.has(mover.model), mover.model);
  const kinds = (kind: string) => output.markers.filter((m) => m.kind === kind);
  assert.ok(kinds('teleport').length >= 3);
  assert.deepEqual(
    kinds('spawn')
      .map((m) => m.kind === 'spawn' && m.vehicle)
      .sort(),
    ['car', 'plane'],
  );
  assert.ok(kinds('emitter').length >= 2);
  assert.ok(output.lights.length > 0 && output.lights.every((l) => l.night));
  assert.deepEqual([...new Set(output.roads.map((r) => r.class))].sort(), [
    'avenue',
    'runway',
    'secondary',
    'taxiway',
  ]);
  assert.ok(airportRegion.ground.length > 0);
  assert.ok(Math.abs(airportRegion.refine!(1234, 5678, 100)) <= 1.2);
});

test('rectangles overlap when they share area, not when they touch or pass diagonally', () => {
  const square = (x: number, z: number, yaw = 0): Rect => ({ x, z, hw: 1, hd: 1, yaw });
  assert.ok(overlaps(square(0, 0), square(1.5, 0)));
  assert.ok(!overlaps(square(0, 0), square(2, 0)));
  // Two diamonds whose bounding boxes overlap but whose sides do not.
  assert.ok(!overlaps(square(0, 0, Math.PI / 4), square(2.6, 0.9, Math.PI / 4)));
  assert.ok(inside(square(0, 0, 0.3), 0.5, 0.5) && !inside(square(0, 0), 1.2, 0));
});
