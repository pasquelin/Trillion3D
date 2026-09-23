import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mountainsRegion } from '../regions/mountains/index.ts';
import { bridgeDeck } from './bridges.ts';
import { WORLD } from './contract.ts';
import { REGION_BOUNDS } from './layout.ts';
import { createPlan, isTerrainPlan, subSeedOf } from './plan.ts';
import { ROAD_STEP } from './roads.ts';
import { COVER, CROWN, MIN_RUN } from './tunnels.ts';

const plan = createPlan();

describe('open world plan: places, shores, seeds, bridges and tunnels', () => {
  it('adds a region refinement inside the region, faded across its border band', () => {
    const desert = {
        name: 'desert' as const,
        ground: [],
        refine: () => 40,
        generate: () => ({
          props: [],
          instances: [],
          lights: [],
          markers: [],
          movers: [],
          roads: [],
        }),
      },
      refined = createPlan(WORLD.seed, [desert]),
      lift = (x: number, z: number) => refined.uneroded(x, z) - refined.relief.height(x, z),
      border = REGION_BOUNDS.desert.maxX;
    const near = (value: number, expected: number) =>
      assert.ok(Math.abs(value - expected) < 1e-9, `${value}`);
    near(lift(border - 5_000, 0), 40);
    near(lift(border + 5_000, 0), 0);
    near(lift(border, 0), 20);
    for (let x = border - 1_000; x < border + 1_000; x += 10)
      assert.ok(Math.abs(lift(x + 10, 0) - lift(x, 0)) < 1, `step at ${x}`);
  });
  it('grows every shore through sea level without a step, with a beach band', () => {
    let beach = 0;
    for (let along = -3_500; along <= 3_500; along += 500)
      for (const [x0, z0, dx, dz] of [[along, plan.relief.southCoastZ(along), 0, 1]]) {
        let previous = plan.relief.height(x0 - 300 * dx, z0 - 300 * dz);
        for (let t = -299; t <= 300; t++) {
          const h = plan.relief.height(x0 + t * dx, z0 + t * dz);
          assert.ok(Math.abs(h - previous) < 0.2, `step of ${h - previous} m at ${x0}, ${z0}`);
          if (h > 0 && h < 2.5) beach++;
          previous = h;
        }
      }
    assert.ok(beach > 1_000, `${beach} beach samples`);
  });
  it('settles every place inside its own region, on dry land, an island port included', () => {
    for (const s of plan.settlements) {
      const b = REGION_BOUNDS[s.region];
      assert.ok(s.centre[0] >= b.minX && s.centre[0] <= b.maxX, `${s.id} x`);
      assert.ok(s.centre[2] >= b.minZ && s.centre[2] <= b.maxZ, `${s.id} z`);
      assert.ok(plan.height(s.centre[0], s.centre[2]) > WORLD.seaLevel, `${s.id} in the sea`);
    }
    assert.ok(plan.settlements.some((s) => s.region === 'coast' && s.kind === 'village'));
    assert.equal(plan.settlements.find((s) => s.id === 'island-port')?.region, 'coast');
  });
  it('gives regions the sub-seed of their name before the plan exists', () => {
    assert.equal(subSeedOf(WORLD.seed, 'region/coast'), plan.regions.coast.seed);
    assert.equal(subSeedOf(WORLD.seed, 'sky'), plan.subSeed('sky'));
  });
  it('lays every bridge deck on its road from end to end, clear of the water, without a step', () => {
    for (const bridge of plan.bridges) {
      const deck = bridgeDeck(plan, bridge);
      assert.deepEqual([deck[0], deck.at(-1)], [bridge.from, bridge.to]);
      for (let k = 1; k < deck.length; k++) {
        const run = Math.hypot(deck[k][0] - deck[k - 1][0], deck[k][2] - deck[k - 1][2]);
        assert.ok(Math.abs(deck[k][1] - deck[k - 1][1]) < 0.6 * run, `${bridge.id} step at ${k}`);
      }
      // Every river point under the span sits at least the clearance below the deck.
      for (const p of deck.slice(1, -1))
        for (const river of plan.rivers)
          river.points.forEach((w, k) => {
            if (Math.hypot(w[0] - p[0], w[2] - p[2]) < river.widths[k] / 2)
              assert.ok(p[1] >= w[1] + 5, `${bridge.id} over ${river.id}`);
          });
    }
  });
  it('bores tunnels through ridges, leaving their ground whole, instead of open canyons', () => {
    const ranges = createPlan(WORLD.seed, [mountainsRegion]);
    assert.ok(isTerrainPlan(ranges) && ranges.tunnels.length > 0);
    for (const { road, bridge, tunnel } of ranges.courses) {
      // No covered run a tunnel's length or more, with ground over its crown, is left open.
      let run: number[] = [];
      const close = () => {
        const length = run.length > 1 ? (run.length - 1) * (ROAD_STEP * 0.9) : 0,
          crown = run
            .map(
              (k) => ranges.beforeRoads(road.points[k][0], road.points[k][2]) - road.points[k][1],
            )
            .sort((a, b) => a - b)[run.length >> 1];
        assert.ok(length < MIN_RUN || crown <= CROWN, `${road.id} open from ${run[0]}`);
        run = [];
      };
      road.points.forEach((p, k) => {
        const inside = tunnel[k] || tunnel[k - 1] || bridge[k] || bridge[k - 1],
          [a, b] = [
            road.points[Math.max(0, k - 1)],
            road.points[Math.min(road.points.length - 1, k + 1)],
          ],
          length = Math.hypot(b[0] - a[0], b[2] - a[2]),
          reach = road.width / 2 + 20,
          [nx, nz] = [(-(b[2] - a[2]) / length) * reach, ((b[0] - a[0]) / length) * reach],
          covered = [1, -1].every(
            (s) => ranges.beforeRoads(p[0] + nx * s, p[2] + nz * s) - p[1] > COVER,
          );
        if (!inside && covered) run.push(k);
        else if (run.length) close();
      });
      if (run.length) close();
    }
    for (const t of ranges.tunnels) {
      // Its portals stand on the road; the ground between them is the ridge.
      const over = bridgeDeck(ranges, t)
        .slice(1, -1)
        .map((p) => ranges.height(p[0], p[2]) - p[1])
        .sort((a, b) => a - b);
      assert.ok(over[over.length >> 1] > CROWN, `${t.id} lost its ground`);
    }
  });
});
