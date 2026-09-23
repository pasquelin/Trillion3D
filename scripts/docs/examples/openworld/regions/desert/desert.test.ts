import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WORLD, type Instance } from '../../plan/contract.ts';
import { createPlan } from '../../plan/plan.ts';
import { propProblems, triangleCount } from '../../props/index.ts';
import { footprints, type Footprint } from './catalog.ts';
import { overlaps, segmentDistance, type Point } from './geometry2.ts';
import { inBounds as within, outputBytes, outputPoints, standProblems } from '../testing.ts';
import { desertRegion } from './index.ts';
import { axes, corners } from './site.ts';

const plan = createPlan(WORLD.seed, [desertRegion]),
  { bounds, budget } = plan.regions.desert,
  out = desertRegion.generate(plan),
  needs = footprints(out.props);

/**
 * Unique triangles the region's props may take: the lead's target for every region (≈ 400 k),
 * with 5 % of headroom. The plan's own `budget.triangles` is a scaled-down demand (see the
 * region's report); nodes are held to the plan's budget exactly.
 */
const TRIANGLE_TARGET = 420_000;

/** Each placed node with its footprint in world space (spans of the line hang in the air). */
const placed = out.instances.flatMap((instance) => {
  const fp = needs.get(instance.prop);
  if (!fp) return [];
  const [sx, sy, sz] = axes(instance.scale),
    [x, , z] = instance.position;
  return [{ instance, fp, sy, shape: corners(fp, x, z, instance.yaw, sx, sz) }];
});

const inBounds = within(bounds);

/** Pairs of shapes sharing a 256 m cell, each pair once. */
function neighbours<T extends { shape: Point[] }>(items: readonly T[]): [T, T][] {
  const cells = new Map<string, number[]>(),
    pairs = new Set<string>(),
    out: [T, T][] = [];
  items.forEach(({ shape }, index) => {
    const xs = shape.map((p) => Math.floor(p[0] / 256)),
      zs = shape.map((p) => Math.floor(p[1] / 256));
    for (let i = Math.min(...xs); i <= Math.max(...xs); i++)
      for (let j = Math.min(...zs); j <= Math.max(...zs); j++) {
        const list = cells.get(`${i},${j}`) ?? [];
        for (const other of list) {
          const key = `${other},${index}`;
          if (pairs.has(key)) continue;
          pairs.add(key);
          out.push([items[other], items[index]]);
        }
        cells.set(`${i},${j}`, [...list, index]);
      }
  });
  return out;
}

describe('desert region', () => {
  it('gives the same bytes for the same plan', () => {
    assert.ok(outputBytes(desertRegion.generate(plan)).equals(outputBytes(out)));
  });

  it('keeps every node, light, marker, mover and road inside its bounds', () => {
    for (const { shape, instance } of placed)
      assert.ok(
        shape.every(([x, z]) => inBounds([x, 0, z])),
        instance.name ?? instance.prop,
      );
    for (const p of outputPoints(out)) assert.ok(inBounds(p), `${p}`);
  });

  it('stays within its node budget and its triangle target', (t) => {
    const triangles = out.props.reduce((sum, p) => sum + triangleCount(p), 0);
    t.diagnostic(`${triangles} unique triangles, ${out.instances.length} nodes`);
    assert.ok(out.instances.length <= budget.nodes, `${out.instances.length} nodes`);
    assert.ok(triangles <= TRIANGLE_TARGET, `${triangles} triangles`);
  });

  it('never lets two footprints overlap', () => {
    for (const [a, b] of neighbours(placed))
      assert.ok(!overlaps(a.shape, b.shape), `${a.instance.prop} × ${b.instance.prop}`);
  });

  it('stands every node on its ground, above the sea, neither floating nor buried', () => {
    for (const { instance, fp, sy, shape } of placed) {
      const [x, y, z] = instance.position,
        heights = [...shape, [x, z] as Point].map(([px, pz]) => plan.height(px, pz)),
        low = Math.min(...heights),
        high = Math.max(...heights),
        name = instance.name ?? instance.prop;
      assert.ok(y <= low + 1e-3, `${name} floats`);
      assert.ok(y >= high - (fp.plinth + fp.sink) * sy - 1e-3, `${name} is buried`);
      assert.ok(low > WORLD.seaLevel, `${name} stands in the sea`);
    }
  });

  it('keeps every footprint off the roads, the plan’s and its own', () => {
    const lines = [...plan.roads, ...out.roads].flatMap((road) =>
      road.points.slice(1).map((b, i) => {
        const a = road.points[i];
        return {
          shape: [
            [a[0], a[2]],
            [b[0], b[2]],
          ] as Point[],
          half: road.width / 2,
        };
      }),
    );
    const roadside = lines.filter(({ shape }) => shape.some(([x, z]) => inBounds([x, 0, z])));
    for (const [a, b] of neighbours<{ shape: Point[]; half?: number; fp?: Footprint }>([
      ...placed,
      ...roadside,
    ])) {
      const [road, node] = a.half !== undefined ? [a, b] : [b, a];
      if (road.half === undefined || node.half !== undefined) continue;
      const [p, q] = road.shape;
      assert.ok(segmentDistance(node.shape, p, q) >= road.half, `on a road: ${node.shape}`);
    }
  });

  it('grows palm groves round its oases, each standing right', () => {
    assert.ok(out.instances.some((i) => i.prop === 'tree-stand-palm-0'));
    assert.deepEqual(standProblems(plan, out), []);
  });

  it('builds sound props and places only props it has or the kit shares', () => {
    const ids = out.props.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(out.props.flatMap(propProblems), []);
    const known = new Set([...ids, ...needs.keys(), 'wind-turbine-rotor', 'desert/tumbleweed']);
    const models = out.movers.flatMap((m) => (m.kind === 'beacon' ? [] : [m.model]));
    for (const id of [...out.instances.map((i: Instance) => i.prop), ...models])
      assert.ok(known.has(id), id);
  });

  it('fills the contract: relief, ground, teleports, a car, effects, night lamps, rotors', () => {
    assert.equal(desertRegion.name, 'desert');
    assert.ok(Number.isFinite(desertRegion.refine!(-15_000, 0, 500)));
    assert.ok(desertRegion.ground.length > 2);
    const names = out.markers.filter((m) => m.kind === 'teleport').map((m) => m.name);
    for (const name of ['desert/mesa-sunset', 'desert/oasis', 'desert/gas-station'])
      assert.ok(names.includes(name), name);
    assert.equal(new Set(out.markers.map((m) => m.name)).size, out.markers.length);
    assert.ok(out.markers.some((m) => m.kind === 'spawn' && m.vehicle === 'car'));
    const effects = new Set(out.markers.flatMap((m) => (m.kind === 'emitter' ? [m.effect] : [])));
    for (const effect of ['sand', 'heat-haze', 'road-dust'] as const)
      assert.ok(effects.has(effect), effect);
    assert.ok(out.lights.some((l) => l.night));
    assert.ok(out.movers.some((m) => m.kind === 'spin' && m.model === 'wind-turbine-rotor'));
  });

  it('proves its footprint geometry directly', () => {
    const square = (x: number): Point[] => [
      [x, 0],
      [x + 1, 0],
      [x + 1, 1],
      [x, 1],
    ];
    assert.ok(overlaps(square(0), square(0.5)));
    assert.ok(!overlaps(square(0), square(1)));
    assert.equal(segmentDistance(square(0), [3, 0.5], [5, 0.5]), 2);
    assert.equal(segmentDistance(square(0), [-1, 0.5], [2, 0.5]), 0);
  });
});
