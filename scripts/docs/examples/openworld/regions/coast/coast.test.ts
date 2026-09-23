import test from 'node:test';
import assert from 'node:assert/strict';
import type { Instance } from '../../plan/contract.ts';
import { sharedProps, triangleCount } from '../../props/index.ts';
import { propProblems } from '../../props/validate.ts';
import { createPlan } from '../../plan/plan.ts';
import { inBounds, outputBytes, standProblems } from '../testing.ts';
import { coastRegion } from './index.ts';
import { seatOf } from './props/index.ts';
import {
  corners,
  extentOf,
  overlaps,
  rectOfInstance,
  roadIndex,
  type Rect,
} from './sites/footprint.ts';

const plan = createPlan(undefined, [coastRegion]),
  output = coastRegion.generate(plan),
  { bounds, budget } = plan.regions.coast,
  extents = new Map(
    [...output.props, ...sharedProps(plan.subSeed('props'))].map((p) => [p.id, extentOf(p)]),
  ),
  rects = output.instances.map((i) => rectOfInstance(extents.get(i.prop)!, i));

const inside = inBounds(bounds);

test('the same plan gives the same bytes', () => {
  assert.ok(outputBytes(output).equals(outputBytes(coastRegion.generate(plan))));
});

test('everything stays inside the region', () => {
  for (const r of rects) for (const [x, z] of corners(r)) assert.ok(inside([x, 0, z]));
  for (const light of output.lights) assert.ok(inside(light.position), light.name);
  for (const marker of output.markers) assert.ok(inside(marker.position), marker.name);
  for (const mover of output.movers)
    for (const p of mover.kind === 'path' ? mover.points : [mover.position])
      assert.ok(inside(p), mover.name);
  for (const road of output.roads) for (const p of road.points) assert.ok(inside(p), road.id);
});

/** The lead's target of unique triangles for a region (≈ 400 k), not the plan's 200 k figure. */
const TARGET = 400_000;

test('the coast stays within its budget, measured', () => {
  const triangles = output.props.reduce((sum, p) => sum + triangleCount(p), 0);
  assert.equal(triangles, 369_147);
  assert.ok(triangles <= TARGET * 1.1);
  assert.ok(output.instances.length <= budget.nodes);
  assert.ok(output.instances.length > budget.nodes * 0.9, 'the node budget is spent');
});

test('no two props overlap and none stands on a road', () => {
  const cell = 64,
    grid = new Map<string, number[]>(),
    clear = roadIndex([...plan.roads, ...output.roads]);
  rects.forEach((r, index) => {
    const reach = Math.hypot(r.hx, r.hz);
    for (let i = Math.floor((r.x - reach) / cell); i <= Math.floor((r.x + reach) / cell); i++)
      for (let k = Math.floor((r.z - reach) / cell); k <= Math.floor((r.z + reach) / cell); k++) {
        const list = grid.get(`${i},${k}`) ?? [];
        for (const other of list)
          assert.ok(
            // Pieces of one building (the lighthouse and its lantern) share one origin.
            String(output.instances[index].position) === String(output.instances[other].position) ||
              !overlaps(r, rects[other]),
            `${output.instances[index].prop} × ${output.instances[other].prop}`,
          );
        grid.set(`${i},${k}`, [...list, index]);
      }
    if (!output.instances[index].prop.startsWith('coast-bridge'))
      assert.ok(clear(r), `${output.instances[index].prop} on a road`);
  });
});

test('props stand on the ground, float on the sea or ride their deck', () => {
  const ground = (r: Rect) => [...corners(r), [r.x, r.z]].map(([x, z]) => plan.height(x, z));
  output.instances.forEach((instance: Instance, index) => {
    const heights = ground(rects[index]),
      [, y] = instance.position,
      seat = seatOf(instance.prop);
    if (seat === 'ground') {
      assert.ok(
        Math.abs(y - Math.min(...heights)) < 1e-9,
        `${instance.prop} sits on its lowest ground`,
      );
      if (/house|cafe|lighthouse|hut/.test(instance.prop))
        assert.ok(Math.max(...heights) - y <= 1.5, `${instance.prop} is on flat ground`);
    } else if (seat === 'water')
      assert.ok(y === 0 && Math.max(...heights) < -0.5, `${instance.prop} floats`);
    else if (seat === 'deck')
      assert.ok(
        plan.height(instance.position[0], instance.position[2]) < y,
        `${instance.prop} clears the ground`,
      );
  });
});

test('the pine woods hold closed stands, each standing right', () => {
  assert.ok(output.instances.some((i) => i.prop.startsWith('tree-stand-alpine-')));
  assert.deepEqual(standProblems(plan, output), []);
});

test('props are sound and every placed id exists', () => {
  assert.deepEqual(output.props.flatMap(propProblems), []);
  const ids = output.props.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const instance of output.instances) assert.ok(extents.has(instance.prop), instance.prop);
});

test('the region declares its viewpoints, spawns, effects, lamps and movers', () => {
  const names = (kind: string) => output.markers.filter((m) => m.kind === kind).map((m) => m.name);
  assert.deepEqual(names('teleport').sort(), [
    'coast/beach',
    'coast/island-port',
    'coast/lighthouse-gallery',
  ]);
  assert.deepEqual(names('spawn').sort(), ['coast/island-port-boat', 'coast/pier-boat']);
  const effects = new Set(output.markers.flatMap((m) => (m.kind === 'emitter' ? [m.effect] : [])));
  assert.deepEqual([...effects].sort(), ['birds', 'lighthouse-beam', 'sea-spray']);
  assert.ok(output.lights.some((l) => l.name === 'coast/lighthouse/lantern' && l.night));
  assert.ok(output.lights.every((l) => l.night));
  assert.equal(output.movers.filter((m) => m.kind === 'beacon').length, 1);
  assert.ok(output.movers.filter((m) => m.kind === 'path').length >= 4, 'boats sail');
  assert.equal(coastRegion.name, 'coast');
  assert.ok(coastRegion.ground.length > 0);
  assert.equal(coastRegion.refine!(24_000, 0, -3), 0, 'the sea is left to the plan');
});
