import test from 'node:test';
import assert from 'node:assert/strict';
import type { Instance } from '../../plan/contract.ts';
import { sharedProps, triangleCount } from '../../props/index.ts';
import { propProblems } from '../../props/validate.ts';
import { BASEMENT } from './chalet.ts';
import { createPlan } from '../../plan/plan.ts';
import { mountainsRegion } from './index.ts';
import { AERIAL, layoutMountains } from './layout.ts';
import { inBounds, outputBytes, standProblems } from '../testing.ts';

const plan = createPlan(undefined, [mountainsRegion]),
  { output, stats } = layoutMountains(plan),
  { bounds, budget } = plan.regions.mountains;

const within = inBounds(bounds);

/**
 * The lead's target for the region's own unique triangles (23 Sept. 2026); the plan's demand
 * table still asks 200 000 of every region.
 */
const TRIANGLE_TARGET = 400_000;

/** Props standing on a road on purpose, their height the road's: portals and bridge spans. */
const onRoad = (i: Instance) => /^mountains\/(tunnel-portal-|bridge\/)/.test(i.prop);
/** A bridge's spans are one structure, and the forest's patches another: they may touch. */
const stand = (i: Instance) => i.prop.startsWith('tree-stand-');
const structure = (i: Instance) =>
  stand(i) ? 'forest' : /^mountains\/bridge\/(.*)\/span-\d+$/.exec(i.prop)?.[1];

/** The footprint radius of every mesh, straight from its vertices. */
const radii = new Map(
  [...output.props, ...sharedProps(plan.subSeed('props'))].map((p) => {
    let r = 0;
    for (const part of p.parts)
      for (let v = 0; v < part.positions.length; v += 3)
        r = Math.max(r, Math.hypot(part.positions[v], part.positions[v + 2]));
    return [p.id, r] as const;
  }),
);
const footprint = (i: Instance) => {
  const s = i.scale ?? 1;
  return radii.get(i.prop)! * (typeof s === 'number' ? s : Math.max(s[0], s[2]));
};

test('the same plan gives the same bytes', () => {
  assert.ok(outputBytes(mountainsRegion.generate(plan)).equals(outputBytes(output)));
});

test('the region is whole: waterfall, bridges, villages, cable car, observatory, forest', () => {
  assert.equal(stats.waterfalls, 1);
  assert.ok(stats.bridgeSpans > 0);
  assert.equal(stats.missingPylons, 0);
  assert.equal(stats.portals % 2, 0, 'a tunnel has two portals');
  assert.ok(stats.trees > 10_000 && stats.rocks > 1_000 && stats.crags > 100);
  const count = (prefix: string) =>
    output.instances.filter((i) => i.prop.startsWith(prefix)).length;
  const villages = plan.settlements.filter((s) => s.region === 'mountains' && within(s.centre));
  assert.ok(villages.length > 0);
  assert.equal(count('mountains/church'), villages.length, 'one church per mountain settlement');
  assert.equal(count('mountains/observatory'), 1);
  assert.equal(count('mountains/cable-station'), 2);
  assert.ok(count('mountains/chalet-') >= 20 && count('mountains/cable-pylon-') >= 2);
});

test('everything stands inside the bounds, within budget', () => {
  assert.deepEqual(
    output.instances.filter((i) => !within(i.position)),
    [],
  );
  assert.deepEqual(
    output.lights.filter((l) => !within(l.position)),
    [],
  );
  assert.deepEqual(
    output.markers.filter((m) => !within(m.position)),
    [],
  );
  for (const mover of output.movers)
    assert.ok('points' in mover ? mover.points.every(within) : within(mover.position), mover.name);
  const triangles = output.props.reduce((sum, p) => sum + triangleCount(p), 0);
  assert.ok(triangles <= Math.max(budget.triangles, TRIANGLE_TARGET), `${triangles} triangles`);
  assert.ok(output.instances.length <= budget.nodes, `${output.instances.length} nodes`);
});

test('no two footprints overlap, and none lies on a road', () => {
  const cell = 64,
    grid = new Map<string, { x: number; z: number; r: number; i: number }[]>(),
    grounded = output.instances.filter((i) => !AERIAL.has(i.prop));
  const overlaps: string[] = [];
  grounded.forEach((inst, i) => {
    const [x, , z] = inst.position,
      r = footprint(inst);
    for (let gx = Math.floor((x - r) / cell); gx <= Math.floor((x + r) / cell); gx++)
      for (let gz = Math.floor((z - r) / cell); gz <= Math.floor((z + r) / cell); gz++) {
        const list = grid.get(`${gx},${gz}`) ?? [];
        for (const o of list)
          if (
            o.i !== i &&
            (!structure(inst) || structure(inst) !== structure(grounded[o.i])) &&
            Math.hypot(o.x - x, o.z - z) < o.r + r - 1e-6
          )
            overlaps.push(`${inst.name} × ${grounded[o.i].name}`);
        list.push({ x, z, r, i });
        grid.set(`${gx},${gz}`, list);
      }
  });
  assert.deepEqual([...new Set(overlaps)], []);
  const onRoads = grounded.filter((inst) => {
    if (onRoad(inst)) return false;
    const [x, , z] = inst.position,
      r = footprint(inst);
    return plan.roads.some((road) =>
      road.points.slice(1).some((b, k) => {
        const a = road.points[k],
          [dx, dz] = [b[0] - a[0], b[2] - a[2]],
          t = Math.max(
            0,
            Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1)),
          );
        return Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz) < road.width / 2 + r;
      }),
    );
  });
  assert.deepEqual(
    onRoads.map((i) => i.name),
    [],
  );
});

test('nothing floats and nothing is buried', () => {
  const wrong = output.instances.filter((inst) => {
    if (AERIAL.has(inst.prop) || onRoad(inst) || stand(inst)) return false;
    const [x, y, z] = inst.position,
      ground = plan.height(x, z);
    return y - ground < -2.1 || y - ground > BASEMENT + 1e-6;
  });
  assert.deepEqual(
    wrong.map((i) => i.name),
    [],
  );
});

test('the forest is closed stands with single trees on their margin', () => {
  assert.ok(stats.stands > 5_000 && stats.standTrees > 40 * stats.stands, JSON.stringify(stats));
  assert.deepEqual(standProblems(plan, output), []);
});

test('props are sound, ids unique, and every reference resolves', () => {
  assert.deepEqual(output.props.flatMap(propProblems), []);
  const ids = output.props.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith('mountains/')));
  const known = new Set([...ids, ...sharedProps(plan.subSeed('props')).map((p) => p.id)]);
  assert.deepEqual(
    output.instances.filter((i) => !known.has(i.prop)).map((i) => i.prop),
    [],
  );
  for (const mover of output.movers)
    if ('model' in mover) assert.ok(ids.includes(mover.model), mover.name);
});

test('the contract: name, refinement, ground layers, markers, lights', () => {
  assert.equal(mountainsRegion.name, 'mountains');
  assert.equal(mountainsRegion.refine!(0, 0, 100), 0, 'the lowlands stay as the plan made them');
  assert.ok(Number.isFinite(mountainsRegion.refine!(-15_000, -20_000, 2_000)));
  assert.equal(
    mountainsRegion.ground.at(-1)!.maxSlope,
    undefined,
    'bare rock takes what nothing else holds',
  );
  const teleports = output.markers.filter((m) => m.kind === 'teleport').map((m) => m.name);
  for (const name of ['mountains/summit-viewpoint', 'mountains/lake-shore', 'mountains/ski-resort'])
    assert.ok(teleports.includes(name), name);
  const effects = new Set(output.markers.flatMap((m) => (m.kind === 'emitter' ? [m.effect] : [])));
  assert.deepEqual([...effects].sort(), ['snow-plume', 'waterfall-spray']);
  assert.ok(output.markers.some((m) => m.kind === 'spawn'));
  assert.ok(output.lights.some((l) => l.night) && output.lights.some((l) => !l.night));
  assert.equal(new Set(output.lights.map((l) => l.name)).size, output.lights.length);
  assert.deepEqual(output.roads, []);
});
