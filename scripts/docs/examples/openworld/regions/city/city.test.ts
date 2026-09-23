import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorldPlan } from '../../plan/contract.ts';
import { createPlan } from '../../plan/plan.ts';
import { propProblems, sharedProps, triangleCount } from '../../props/index.ts';
import { corners, Occupancy, overlaps, segmentBox, xz, type Obb } from './frame.ts';
import { SAMPLE } from './grid.ts';
import { REGIONS } from '../index.ts';
import { outputBytes, outputPoints, standProblems } from '../testing.ts';
import { buildCity, cityRegion } from './index.ts';
import { TOUCH, type Item } from './placement.ts';
import { groundUnder, inBounds } from './site.ts';

// The world as the lead composes it, with the city in it.
const plan = createPlan(undefined, [...REGIONS.filter((r) => r.name !== 'city'), cityRegion]);
const { output, kept, site } = buildCity(plan);

/** The lead's triangle share for the city (#332); `plan/budget.ts` still demands 200 000. */
const TRIANGLES = 400_000;

/** The same plan with another node budget for the city. */
const withNodes = (nodes: number): WorldPlan => ({
  ...plan,
  regions: {
    ...plan.regions,
    city: { ...plan.regions.city, budget: { ...plan.regions.city.budget, nodes } },
  },
});

test('the same plan gives the same bytes', () => {
  assert.ok(outputBytes(output).equals(outputBytes(cityRegion.generate(plan))));
});

test('props are sound, named under city/, and every placed id exists', () => {
  assert.deepEqual(output.props.flatMap(propProblems), []);
  const own = output.props.map((p) => p.id);
  assert.equal(new Set(own).size, own.length);
  assert.ok(own.every((id) => id.startsWith('city/')));
  const known = new Set([...own, ...sharedProps(0).map((p) => p.id)]);
  assert.deepEqual(
    [...new Set(output.instances.map((i) => i.prop))].filter((id) => !known.has(id)),
    [],
  );
  assert.deepEqual(
    output.movers.flatMap((m) => ('model' in m && !known.has(m.model) ? [m.model] : [])),
    [],
  );
  assert.equal(new Set(output.instances.map((i) => i.name)).size, output.instances.length);
});

test('everything lies inside the region bounds', () => {
  assert.deepEqual(
    outputPoints(output).filter((p) => !inBounds(site, xz(p))),
    [],
  );
  assert.ok(kept.every((item) => !item.box || corners(item.box).every((c) => inBounds(site, c))));
});

test('the budget holds: own triangles, and nodes trimmed from the least important', () => {
  const { budget } = plan.regions.city;
  const triangles = output.props.reduce((sum, p) => sum + triangleCount(p), 0);
  assert.ok(triangles <= Math.max(budget.triangles, TRIANGLES), `${triangles} triangles`);
  assert.ok(output.instances.length + output.movers.length <= budget.nodes);
  const tight = buildCity(withNodes(4_000)).output;
  assert.ok(tight.instances.length + tight.movers.length <= 4_000);
  assert.ok(tight.instances.some((i) => i.prop === 'city/tower-round-310'));
  assert.ok(!tight.instances.some((i) => i.prop === 'city/garden-fence'));
});

test('rectangles overlap only when they share area', () => {
  const at = (x: number, z: number, yaw = 0): Obb => ({ centre: [x, z], half: [1, 1], yaw });
  assert.ok(overlaps(at(0, 0), at(1.5, 0)));
  assert.ok(!overlaps(at(0, 0), at(2, 0), TOUCH));
  assert.ok(!overlaps(at(0, 0), at(2.5, 0, Math.PI / 4)));
  assert.ok(overlaps(at(0, 0), at(2.3, 0, Math.PI / 4)));
});

test('no two props of a kind overlap, and only road props lie on roads', () => {
  const clashes = (kind: Item['kind']) => {
    const grid = new Occupancy<Item>(50),
      found: string[] = [];
    for (const item of kept.filter((k) => k.box && k.kind === kind)) {
      for (const other of grid.hits(item.box!, TOUCH))
        found.push(`${item.instance.name} × ${other.instance.name}`);
      grid.add(item.box!, item);
    }
    return found;
  };
  assert.deepEqual(clashes('solid'), []);
  assert.deepEqual(clashes('flat'), []);
  const roads = new Occupancy<string>(120);
  for (const road of [...plan.roads, ...output.roads])
    for (let i = 0; i + 1 < road.points.length; i++)
      roads.add(segmentBox(xz(road.points[i]), xz(road.points[i + 1]), road.width / 2), road.id);
  const onRoad = kept.filter((k) => k.box && k.kind !== 'road' && roads.hits(k.box, TOUCH).length);
  assert.deepEqual(
    onRoad.map((k) => k.instance.name),
    [],
  );
});

test('nothing floats and nothing is buried', () => {
  const wrong = kept.flatMap((item) => {
    if (!item.box || item.support === undefined) return [];
    const ground = groundUnder(site, item.box, SAMPLE),
      y = item.instance.position[1];
    return item.support <= Math.min(...ground) + 0.05 && y >= Math.min(...ground) - 0.05
      ? []
      : [item.instance.name];
  });
  assert.deepEqual(wrong, []);
});

test('the parks hold woods on their lawns, clear of roads and solids', () => {
  assert.ok(output.instances.some((i) => i.prop.startsWith('tree-stand-broadleaf-')));
  // A park's woods stand on its block's plinth, not on the ground under it.
  assert.deepEqual(standProblems(plan, output, true), []);
});

test('the contract: teleports, spawns, emitters, night lamps, movers, avenues', () => {
  const names = output.markers.map((m) => m.name);
  for (const name of ['city/rooftop', 'city/downtown', 'city/harbour'])
    assert.ok(names.includes(name), name);
  assert.ok(output.markers.some((m) => m.kind === 'spawn' && m.vehicle === 'car'));
  assert.ok(output.markers.some((m) => m.kind === 'spawn' && m.vehicle === 'boat'));
  for (const effect of ['fountain', 'neon-glow', 'smoke'])
    assert.ok(
      output.markers.some((m) => m.kind === 'emitter' && m.effect === effect),
      effect,
    );
  assert.ok(output.lights.length > 0 && output.lights.every((l) => l.night));
  assert.ok(
    output.movers.some((m) => m.kind === 'spin') && output.movers.some((m) => m.kind === 'path'),
  );
  assert.ok(output.roads.length > 0 && output.roads.every((r) => r.class === 'avenue'));
  assert.equal(cityRegion.refine!(0, 0, 0), 0);
  assert.ok(cityRegion.ground.length > 0);
});
