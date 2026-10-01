// OMB-26 (#966): the raster bins by size class draw the very triangles the region lists drew (E0),
// each command at its class's largest caster, never more vertex invocations. The shipped kernel runs
// under node (`binReplay.fixture.ts`) on 10 000 random sets and the audit's edge cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';
import { DRAW_INDIRECT_WORDS as WORDS } from '../draw/contract.ts';
import { MOBILITY_CORNER_SHIFT, MOBILITY_CUTOUT } from './cullShader.ts';
import {
  SHADOW_BIN_CLASSES,
  SHADOW_BIN_COMMANDS,
  SHADOW_BIN_CORNERS,
  shadowBinOf,
} from './binShader.ts';
import { binKernel, runBins } from './binReplay.fixture.ts';
import { createShadowMobility } from '../../webgpu/shadow/mobility.ts';

const UNTOUCHED = 0xdeadbeef;
type Caster = { corners: number; cutout: boolean };
type Region = { kept: number[]; binned: boolean };

/** The cull's lists of `regions` over `casters`, filed in a random order as its atomics file them,
 *  each list's command at its largest caster's corners (`keepCaster`). */
function cullLists(casters: Caster[], regions: Region[], capacity: number, rng: () => number) {
  const list = new Array<number>(regions.length * capacity).fill(-1),
    counts = new Array<number>(regions.length * 2 * WORDS).fill(0);
  regions.forEach(({ kept }, region) => {
    for (const row of [...kept].sort(() => rng() - 0.5)) {
      const { corners, cutout } = casters[row],
        command = (region * 2 + +cutout) * WORDS,
        rank = counts[command + 1]++;
      list[region * capacity + (cutout ? capacity - 1 - rank : rank)] = row;
      counts[command] = Math.max(counts[command], corners);
    }
  });
  return { list, counts };
}

/** Each triangle a draw of `commands` rasterizes, as `row:triangle`, and its vertex invocations:
 *  instance `i` of a command reads place `first + i` from its list's end (`drawPage`, `cutoutPage`). */
function drawn(
  commands: number[],
  perList: number,
  rows: (region: number, place: number, cutout: boolean) => number,
  region: number,
  casters: Caster[],
) {
  const triangles: string[] = [];
  let invocations = 0;
  for (let k = 0; k < 2 * perList; k++) {
    const at = (region * 2 * perList + k) * WORDS,
      [corners, count, firstVertex, first] = commands.slice(at, at + WORDS),
      cutout = k >= perList;
    assert.equal(firstVertex, 0);
    invocations += corners * count;
    for (let i = 0; i < count; i++) {
      const row = rows(region, first + i, cutout);
      const own = casters[row].corners;
      // A corner past the row's own count is degenerate: the triangles it draws are its own.
      for (let t = 0; 3 * t + 2 < Math.min(corners, own); t++) triangles.push(`${row}:${t}`);
      // Up to a cluster's 128 triangles, a bin pads none of its casters by 32 triangles or more
      // (a caster with no corner draws none).
      if (perList > 1 && own > 0 && corners <= SHADOW_BIN_CLASSES * SHADOW_BIN_CORNERS)
        assert.ok(corners - own < SHADOW_BIN_CORNERS, 'at most 31 padded triangles a caster');
    }
  }
  return { triangles: triangles.sort(), invocations };
}

/** The bins of `regions` against the region lists, region by region: same triangles, fewer or as
 *  many invocations; a region the mask leaves out keeps its commands. Returns the invocations. */
function binsMatch(casters: Caster[], regions: Region[], capacity: number, rng: () => number) {
  const { list, counts } = cullLists(casters, regions, capacity, rng);
  const mobility = casters.map(
    ({ corners, cutout }) => (corners << MOBILITY_CORNER_SHIFT) | (cutout ? MOBILITY_CUTOUT : 0),
  );
  const commands = new Array<number>(regions.length * SHADOW_BIN_COMMANDS * WORDS).fill(UNTOUCHED);
  const binned = new Array<number>(regions.length * capacity).fill(-1);
  const mask = [0, 0];
  regions.forEach((region, r) => region.binned && (mask[r >> 5] |= 1 << (r & 31)));
  const uni = {
    regions: regions.length,
    capacity,
    maskLow: mask[0] >>> 0,
    maskHigh: mask[1] >>> 0,
  };
  const kernel = binKernel(false, { uni, list, counts, mobility, binned, commands });
  const lanes = () => [...Array(64).keys()].sort(() => rng() - 0.5);
  runBins(kernel, regions.length, lanes);
  const total = [0, 0];
  regions.forEach((region, r) => {
    const at = r * SHADOW_BIN_COMMANDS * WORDS;
    if (!region.binned)
      return assert.ok(
        commands.slice(at, at + SHADOW_BIN_COMMANDS * WORDS).every((w) => w === UNTOUCHED),
      );
    const place = (from: number[]) => (r: number, i: number, cutout: boolean) =>
      from[r * capacity + (cutout ? capacity - 1 - i : i)];
    const before = drawn(counts, 1, place(list), r, casters),
      after = drawn(commands, SHADOW_BIN_CLASSES, place(binned), r, casters);
    assert.deepEqual(after.triangles, before.triangles, 'the same triangles, each once');
    assert.ok(after.invocations <= before.invocations, 'never more vertex invocations');
    total[0] += before.invocations;
    total[1] += after.invocations;
  });
  return total;
}

/** A caster of 1 to 128 triangles, now and then none or a line page's more, a third cutouts. */
const randomCaster = (rng: () => number): Caster => {
  const pick = rng(),
    triangles =
      pick < 0.05 ? 0 : pick < 0.1 ? 129 + Math.floor(rng() * 300) : 1 + Math.floor(rng() * 128);
  return { corners: 3 * triangles, cutout: rng() < 0.3 };
};

test('10 000 random cluster sets: the bins draw the region lists’ triangles, never more invocations', () => {
  const rng = mulberry32(966);
  const total = [0, 0];
  for (let set = 0; set < 10_000; set++) {
    const casters = Array.from({ length: Math.floor(rng() * 48) }, () => randomCaster(rng)),
      capacity = casters.length + Math.floor(rng() * 4),
      share = rng();
    const regions = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => ({
      kept: [...casters.keys()].filter(() => rng() < share),
      binned: rng() < 0.85,
    }));
    const [before, after] = binsMatch(casters, regions, Math.max(1, capacity), rng);
    total[0] += before;
    total[1] += after;
  }
  // Not vacuous: the bins spared invocations the padded lists ran.
  assert.ok(total[1] < 0.8 * total[0], `${total[1]} of ${total[0]} invocations`);
});

test('edge sets: empty region, all maximal, one triangle, no corner, a full slot, a line page', () => {
  const rng = mulberry32(26);
  const same = (corners: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({ corners, cutout: i % 3 === 0 }));
  const all = (casters: Caster[]) => [{ kept: [...casters.keys()], binned: true }];
  const cases: Array<[string, Caster[], Region[], number]> = [
    ['empty region', same(384, 8), [{ kept: [], binned: true }], 8],
    ['all maximal', same(384, 40), all(same(384, 40)), 40],
    ['single triangle', same(3, 1), all(same(3, 1)), 1],
    ['no corner', same(0, 5), all(same(0, 5)), 6],
    ['line page past 128 triangles', [...same(900, 2), ...same(6, 3)], all(same(0, 5)), 5],
    ['two regions', same(96, 4), [...all(same(96, 4)), ...all(same(96, 4))], 4],
  ];
  for (const [name, casters, regions, capacity] of cases) {
    const [before, after] = binsMatch(casters, regions, capacity, rng);
    if (name === 'all maximal') assert.equal(after, before, name);
    if (name === 'empty region') assert.equal(after, 0, name);
  }
});

test('the host counts each class as the kernel bins it, and holds a class while a row is in it', () => {
  const kernel = binKernel(false, {
    uni: { regions: 0, capacity: 0, maskLow: 0, maskHigh: 0 },
    ...{ list: [], counts: [], mobility: [], binned: [], commands: [] },
  });
  for (let corners = 0; corners < 3 * 1024; corners++) {
    const word = (corners << MOBILITY_CORNER_SHIFT) | MOBILITY_CUTOUT;
    assert.equal(shadowBinOf(word), kernel.binOf(word), `${corners} corners`);
  }
  const mobility = createShadowMobility(),
    corners = [3, 96, 99, 384, 3];
  mobility.ensure(1, corners.length, () => new Float64Array(16));
  const write = () =>
    mobility.writeRows(
      () => 0,
      corners.length,
      0,
      corners.length - 1,
      () => {},
      (row) => corners[row],
    );
  write();
  assert.deepEqual([0, 1, 2, 3].map(mobility.binHolds), [true, true, false, true]);
  corners[3] = 6;
  write();
  assert.deepEqual([0, 1, 2, 3].map(mobility.binHolds), [true, true, false, false]);
});
