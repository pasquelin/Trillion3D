import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { cacheBytes, MARGIN, regionBudgets, TERRAIN_BYTES, textureBytes } from './budget.ts';
import { COOK_COST, WORLD } from './contract.ts';
import { EROSION_CELL } from './erosion.ts';
import { HEIGHT_SAMPLES, tileHeights, writeHeights } from './heights.ts';
import { createPlan } from './plan.ts';

const plan = createPlan();
const HALF = WORLD.size / 2;

/** Everything a plan publishes, heights and biomes sampled on a 1 km grid, as one digest. */
function digest(p: ReturnType<typeof createPlan>) {
  const samples: number[] = [];
  for (let z = -HALF; z <= HALF; z += 1_000)
    for (let x = -HALF; x <= HALF; x += 1_000)
      samples.push(p.height(x, z), ...Object.values(p.biome(x, z).weights));
  const published = [p.regions, p.roads, p.rivers, p.bridges, p.settlements, p.lakes, samples];
  return createHash('sha256').update(JSON.stringify(published)).digest('hex');
}

describe('open world plan', () => {
  it('is the same plan, to the byte, from the same seed, and another from another seed', () => {
    assert.equal(digest(createPlan()), digest(plan));
    assert.notEqual(digest(createPlan(WORLD.seed + 1)), digest(plan));
    assert.equal(createPlan().subSeed('sky'), plan.subSeed('sky'));
    assert.notEqual(plan.subSeed('sky'), plan.subSeed('traffic'));
  });
  it('rises to the peak over one continent with the sea to the south', () => {
    let highest = -Infinity;
    for (let z = -HALF; z <= HALF; z += 250)
      for (let x = -HALF; x <= HALF; x += 250) highest = Math.max(highest, plan.height(x, z));
    assert.ok(highest > WORLD.peak * 0.9 && highest < WORLD.peak * 1.05, `peak ${highest}`);
    assert.ok(plan.height(0, HALF - 100) < 0);
    assert.ok(plan.height(-HALF + 100, 0) > 0 && plan.height(0, -HALF + 100) > 0);
  });
  it('blends biomes with weights that sum to one, the owner holding the largest', () => {
    for (let z = -HALF; z <= HALF; z += 250)
      for (let x = -HALF; x <= HALF; x += 250) {
        const { owner, weights } = plan.biome(x, z),
          values = Object.values(weights);
        assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 1e-9, `${x}, ${z}`);
        assert.equal(weights[owner], Math.max(...values));
      }
  });
  it('keeps every road on land except its bridges, its ground level across its width', () => {
    const everyPoint = plan.courses.flatMap(({ road }) =>
      road.points.map((p, k) => ({ p, road, k })),
    );
    let checked = 0;
    for (const { road, bridge, tunnel } of plan.courses)
      road.points.forEach((p, k) => {
        if (bridge[k] || bridge[k - 1] || tunnel[k] || tunnel[k - 1]) return;
        assert.ok(plan.height(p[0], p[2]) > WORLD.seaLevel, `${road.id} ${k} under the sea`);
        // Level check away from junctions, hairpins, bridge and tunnel ends, where works meet.
        if (k < 2 || k > road.points.length - 3) return;
        if ([...bridge.slice(k - 2, k + 2), ...tunnel.slice(k - 2, k + 2)].some(Boolean)) return;
        const crowded = everyPoint.some(
          (o) =>
            (o.road !== road || Math.abs(o.k - k) > 6) &&
            Math.hypot(o.p[0] - p[0], o.p[2] - p[2]) < (o.road.width + road.width) * 5,
        );
        if (crowded) return;
        const heading = (j: number) =>
            Math.atan2(
              road.points[j + 1][2] - road.points[j][2],
              road.points[j + 1][0] - road.points[j][0],
            ),
          turn = (j: number) => Math.abs(Math.sin((heading(j) - heading(j - 1)) / 2)),
          [a, b] = [road.points[k - 1], road.points[k + 1]];
        if ([k - 1, k, k + 1].some((j) => turn(j) > Math.sin(Math.PI / 12))) return;
        const length = Math.hypot(b[0] - a[0], b[2] - a[2]),
          [nx, nz] = [-(b[2] - a[2]) / length, (b[0] - a[0]) / length];
        for (const side of [-0.45, 0, 0.45]) {
          const offset = side * road.width,
            h = plan.height(p[0] + nx * offset, p[2] + nz * offset);
          // On a bend the edge projects a little along the road, where its grade has moved it.
          const tolerance = side ? 0.1 : 0.02;
          assert.ok(Math.abs(h - p[1]) < tolerance, `${road.id} ${k} at ${side}: ${h - p[1]}`);
        }
        checked++;
      });
    assert.ok(checked > 1_000, `${checked} road points checked`);
  });
  it('plans every road class, a bridge over each river and trails to walk', () => {
    const classes = new Set(plan.roads.map((road) => road.class));
    for (const cls of ['highway', 'secondary', 'pass', 'avenue', 'dirt'] as const)
      assert.ok(classes.has(cls), cls);
    assert.equal(plan.rivers.length, 3);
    assert.ok(plan.bridges.length >= plan.rivers.length);
    for (const kind of ['city', 'town', 'village', 'airport', 'port', 'resort'] as const)
      assert.ok(
        plan.settlements.some((s) => s.kind === kind),
        kind,
      );
  });
  it('fits the terrain and every region budget in the cache envelope with its margin', () => {
    const regions = Object.values(regionBudgets()),
      terrain = TERRAIN_BYTES + cacheBytes({ triangles: 0, nodes: (WORLD.size / WORLD.tile) ** 2 }),
      total = terrain + regions.reduce((sum, budget) => sum + cacheBytes(budget), 0);
    assert.ok(total <= WORLD.cacheBytes * (1 - MARGIN), `${total} bytes`);
    // The terrain takes all the regions leave: less than a byte of the envelope is unspent.
    assert.ok(WORLD.cacheBytes * (1 - MARGIN) - total < 1, `${total} bytes`);
    // A texture costs its texels at the measured cook cost, rounded up to a whole byte.
    assert.equal(textureBytes(128), Math.ceil(128 * 128 * COOK_COST.bytesPerTexel));
    assert.deepEqual(
      Object.fromEntries(Object.entries(plan.regions).map(([name, r]) => [name, r.budget])),
      regionBudgets(),
    );
  });
  it('shares identical physics heights along every tile border of a row and a column', () => {
    const side = HEIGHT_SAMPLES + 1,
      last = HEIGHT_SAMPLES;
    for (let k = 0; k < 49; k++) {
      const [west, east] = [tileHeights(plan, k, 25), tileHeights(plan, k + 1, 25)],
        [north, south] = [tileHeights(plan, 25, k), tileHeights(plan, 25, k + 1)];
      for (let j = 0; j < side; j++) {
        assert.equal(west[j * side + last], east[j * side], `tile ${k} row ${j}`);
        assert.equal(north[last * side + j], south[j], `tile ${k} column ${j}`);
      }
    }
  });
  it('keeps the eroded ground continuous across every tile border', () => {
    for (let k = 1; k < WORLD.size / WORLD.tile; k++)
      for (let along = -HALF + 125; along < HALF; along += 1_000) {
        const border = -HALF + k * WORLD.tile,
          across = [plan.height(border - 1e-3, along), plan.height(border + 1e-3, along)],
          down = [plan.height(along, border - 1e-3), plan.height(along, border + 1e-3)];
        assert.ok(Math.abs(across[1] - across[0]) < 0.05, `x ${border}, z ${along}`);
        assert.ok(Math.abs(down[1] - down[0]) < 0.05, `z ${border}, x ${along}`);
      }
  });
  it('wears the relief down: less ridge-to-valley noise at the erosion cell once eroded', () => {
    const noise = (height: (x: number, z: number) => number) => {
      let sum = 0,
        count = 0;
      for (let z = -HALF + 500; z < HALF - 500; z += 250)
        for (let x = -HALF + 500; x < HALF - 500; x += 250) {
          const h = height(x, z),
            ring = [-1, 1].flatMap((s) => [
              height(x + s * EROSION_CELL, z),
              height(x, z + s * EROSION_CELL),
            ]);
          if (h <= WORLD.seaLevel) continue;
          sum += (h - ring.reduce((a, b) => a + b, 0) / 4) ** 2;
          count++;
        }
      return Math.sqrt(sum / count);
    };
    const before = noise(plan.uneroded),
      after = noise(plan.natural);
    assert.ok(after < before, `${before.toFixed(2)} m → ${after.toFixed(2)} m`);
  });
  it('writes one Float32 height file per tile, row-major from its -X, -Z corner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openworld-heights-'));
    try {
      const flat = { height: (x: number, z: number) => x + 2 * z };
      assert.equal(await writeHeights(dir, flat, 4), 2_500);
      assert.equal((await readdir(join(dir, 'heights'))).length, 2_500);
      const bytes = await readFile(join(dir, 'heights', '1_0.bin')),
        values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
      assert.equal(values.length, 25);
      assert.equal(values[0], -HALF + 1_000 + 2 * -HALF);
      assert.equal(values[1], values[0] + 250);
      assert.equal(values[5], values[0] + 500);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
