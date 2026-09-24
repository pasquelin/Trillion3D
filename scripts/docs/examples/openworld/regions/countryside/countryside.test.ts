import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPoint, sharedProps, triangleCount, trsMatrix } from '../../props/index.ts';
import { propProblems } from '../../props/validate.ts';
import { createPlan } from '../../plan/plan.ts';
import {
  corners,
  GROUND_COVER,
  localFootprint,
  overlaps,
  placedRect,
  segmentRect,
  type Rect,
} from './footprint.ts';
import { inBounds, outputBytes, outputPoints, standProblems } from '../testing.ts';
import { countrysideRegion, TRIANGLES } from './index.ts';
import { PLINTH } from './site.ts';

const plan = createPlan(undefined, [countrysideRegion]),
  { bounds, budget } = plan.regions.countryside,
  output = countrysideRegion.generate(plan),
  shared = sharedProps(plan.seed),
  known = new Map([...shared, ...output.props].map((p) => [p.id, p]));

const within = inBounds(bounds);

const rects = output.instances.map((instance) => ({
  instance,
  rect: placedRect(localFootprint(known.get(instance.prop)!), instance),
}));
const stand = (id: string) => id.startsWith('tree-stand-');
/** Standing in water or on a road by design: bridge spans, the jetty and its boat. */
const afloat = (name = '') => /\/(span-\d+|jetty|boat)$/.test(name);

test('the same plan gives the same bytes', () => {
  assert.ok(outputBytes(output).equals(outputBytes(countrysideRegion.generate(plan))));
});

test('the output follows the contract: props, lights, markers and movers', () => {
  assert.equal(countrysideRegion.name, 'countryside');
  assert.ok(countrysideRegion.ground.length > 0);
  assert.ok(countrysideRegion.refine!(1_000, 1_000, 0) === 0, 'the sea is left alone');
  assert.ok(Number.isFinite(countrysideRegion.refine!(1_000, 1_000, 200)));
  assert.equal(new Set(output.props.map((p) => p.id)).size, output.props.length);
  assert.ok(
    output.props.every((p) => !shared.some((s) => s.id === p.id)),
    'no shared prop copied',
  );
  assert.ok(output.instances.every((i) => known.has(i.prop)));
  assert.ok(output.movers.every((m) => m.kind === 'beacon' || known.has(m.model)));
  assert.ok(
    output.movers.some((m) => m.kind === 'spin'),
    'the windmill turns',
  );
  assert.equal(new Set(output.lights.map((l) => l.name)).size, output.lights.length);
  const teleports = output.markers.filter((m) => m.kind === 'teleport').map((m) => m.name);
  for (const place of ['village-square', 'hilltop', 'forest-clearing', 'windmill'])
    assert.ok(teleports.includes(`countryside/${place}`), place);
  assert.ok(output.markers.some((m) => m.kind === 'spawn' && m.vehicle === 'car'));
  const effects = new Set(output.markers.flatMap((m) => (m.kind === 'emitter' ? [m.effect] : [])));
  assert.deepEqual([...effects].sort(), ['birds', 'fireflies', 'road-dust']);
  assert.ok(output.roads.length > 0 && output.roads.every((r) => r.class === 'dirt'));
});

test('everything stands inside the bounds, within budget', () => {
  assert.ok(outputPoints(output).every(within));
  assert.ok(rects.every(({ rect }) => corners(rect).every(([x, z]) => within([x, 0, z]))));
  assert.ok(output.instances.length <= budget.nodes);
  assert.ok(output.props.reduce((sum, p) => sum + triangleCount(p), 0) <= TRIANGLES);
});

/** Items in a grid of 64 m cells, each under every cell its circle touches. */
function cells<T>(items: readonly T[], circle: (item: T) => [number, number, number]) {
  const grid = new Map<number, T[]>(),
    keys = ([x, z, r]: [number, number, number]) => {
      const out: number[] = [];
      for (let i = Math.floor((x - r) / 64); i <= Math.floor((x + r) / 64); i++)
        for (let j = Math.floor((z - r) / 64); j <= Math.floor((z + r) / 64); j++)
          out.push(i * 100_003 + j);
      return out;
    };
  for (const item of items)
    for (const k of keys(circle(item))) {
      const list = grid.get(k);
      if (list) list.push(item);
      else grid.set(k, [item]);
    }
  return (circle: [number, number, number]) =>
    new Set(keys(circle).flatMap((k) => grid.get(k) ?? []));
}

const circleOf = (rect: Rect): [number, number, number] => [
  rect.x,
  rect.z,
  Math.hypot(rect.hx, rect.hz),
];
const label = ({ instance }: (typeof rects)[number]) => instance.name ?? instance.prop;

test('no two footprints overlap', () => {
  const near = cells(rects, ({ rect }) => circleOf(rect));
  const clashes = rects.filter((a) =>
    [...near(circleOf(a.rect))].some((b) => b !== a && overlaps(a.rect, b.rect)),
  );
  assert.deepEqual(clashes.map(label), []);
});

test("no prop stands on a road, the plan's or the region's own", () => {
  const segments = [...plan.roads, ...output.roads].flatMap((road) =>
      road.points.slice(1).map((p, k) => [road.points[k], p, road.width / 2] as const),
    ),
    near = cells(segments, ([a, b, half]) => [
      (a[0] + b[0]) / 2,
      (a[2] + b[2]) / 2,
      Math.hypot(a[0] - b[0], a[2] - b[2]) / 2 + half,
    ]);
  const onRoad = rects.filter(
    (item) =>
      !afloat(item.instance.name) &&
      [...near(circleOf(item.rect))].some(
        ([a, b, half]) => segmentRect(a[0], a[2], b[0], b[2], item.rect) < half,
      ),
  );
  assert.deepEqual(onRoad.map(label), []);
});

test('nothing floats or sinks: the ground under a footprint stays within its plinth', () => {
  const floating = rects.filter(({ instance, rect }) => {
    // A forest patch stands on its own sloped plane: `standProblems` checks it.
    if (afloat(instance.name) || instance.prop.includes(GROUND_COVER) || stand(instance.prop))
      return false;
    const y = instance.position[1];
    return [...corners(rect), [rect.x, rect.z]].some(([x, z]) => {
      const h = plan.height(x, z);
      return h > y + PLINTH + 1e-6 || h < y - PLINTH - 1e-6;
    });
  });
  assert.deepEqual(floating.map(label), []);
});

test('a field is draped over the ground at its crop height', () => {
  const instance = output.instances.find((i) => i.prop.includes(GROUND_COVER))!,
    [top] = known.get(instance.prop)!.parts,
    turn = trsMatrix({ at: instance.position, yaw: instance.yaw }),
    heights = new Set<number>();
  for (let v = 0; v < top.positions.length; v += 3) {
    const [x, y, z] = applyPoint(turn, [
      top.positions[v],
      top.positions[v + 1],
      top.positions[v + 2],
    ]);
    heights.add(Math.round((y - plan.height(x, z)) * 100) / 100);
  }
  // The crop's top and the skirt's foot: two heights over the ground, everywhere.
  assert.equal(heights.size, 2, [...heights].join(', '));
});

test('the woods are closed stands of the three woodland mixes, each standing right', () => {
  const biomes = new Set(
    output.instances.filter((i) => stand(i.prop)).map((i) => i.prop.split('-')[2]),
  );
  assert.deepEqual([...biomes].sort(), ['alpine', 'birch', 'broadleaf']);
  assert.deepEqual(standProblems(plan, output), []);
});

test('every prop of the region is sound', () => {
  assert.deepEqual(output.props.flatMap(propProblems), []);
});
