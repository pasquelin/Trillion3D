// #965, the audit's equivalence (OMB-01, E0): the split depth draws — opaque casters with no
// fragment stage, cutout ones with the fragment test, filed in two lists by the real mobility words
// and `keptAt` — write the page develop's single draw wrote, to the bit, on random casters and on
// NaN, ±0, ±Inf, empty and maximal inputs. Both run the shipped WGSL (`depthSplit.fixture.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';
import { HOSTILE_FLOATS } from '../../../../../tests/kit/assert/hostile.ts';
import { FLAG_BLEND_CASTER, FLAG_HAS_UV, FLAG_MASK } from '../../visibility/types.ts';
import { createShadowMobility } from '../../webgpu/shadow/mobility.ts';
import { MOBILITY_CUTOUT } from './cullShader.ts';
import {
  rasterDepth,
  shadowEntries,
  vec4f,
  type Mat,
  type ShadowOut,
  type ShadowScene,
} from './depthSplit.fixture.ts';

const SIDE = 24,
  REGION = 1;

type Options = {
  rows: number;
  cutoutShare?: number;
  blended?: number;
  envelope?: number;
  /** A value written over one input word in `spoil` of them (`HOSTILE_FLOATS`). */
  special?: number;
  spoil?: number;
  triangles?: number;
  spare?: number;
};

/** `rows` random casters in one region's slot, and the face that draws them. */
function scene(rng: () => number, o: Options) {
  const odd = (value: number) =>
    o.special !== undefined && rng() < (o.spoil ?? 0) ? o.special : value;
  const around = (spread: number) => odd((rng() * 2 - 1) * spread);
  const blendedFrom = o.rows - (o.blended ?? 0);
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const pages = Array.from({ length: o.rows }, (_, row) => {
    const corners = 3 * (o.triangles ?? 1 + Math.floor(rng() * 3)),
      vertexBase = positions.length / 3,
      pageOffset = indices.length;
    for (let k = 0; k < corners; k++) {
      indices.push(k);
      positions.push(around(1.3), around(1.3), odd(0.1 + rng() * 0.85));
      uvs.push(odd(rng() * 4), rng());
    }
    const cutout = rng() < (o.cutoutShare ?? 0.3);
    const flags = row >= blendedFrom ? FLAG_BLEND_CASTER : cutout ? FLAG_MASK | FLAG_HAS_UV : 0;
    const world = [vec4f(1 + around(0.1), 0, 0, 0), vec4f(0, 1, around(0.1), 0)];
    world.push(vec4f(0, 0, 1, 0), vec4f(around(0.2), around(0.2), around(0.02), 1));
    const dash = { x: odd(0.5 * rng()), y: 0.5 * rng() };
    return { flags, indexCount: corners, pageOffset, vertexBase, world, dash, baseColor: { w: 0 } };
  });
  const viewProjection: Mat = [vec4f(1, 0, 0, 0), vec4f(0, 1, 0, 0), vec4f(0, 0, odd(1), 0)];
  viewProjection.push(vec4f(0, 0, 0, odd(1)));
  const emitter = vec4f(around(1), around(1), rng(), odd(o.envelope ?? 0));
  // The slot, filed as the cull files it: the real mobility words, then `keptAt`.
  const mobility = createShadowMobility();
  mobility.ensure(1, o.rows, () => new Float64Array(16));
  const isCutout = (row: number) => (pages[row].flags & FLAG_MASK) !== 0,
    corners = (row: number) => pages[row].indexCount;
  mobility.writeRows(() => 0, o.rows, 0, o.rows - 1, () => {}, corners, blendedFrom, isCutout);
  const capacity = o.rows + (o.spare ?? 0);
  const world: ShadowScene = {
    pages,
    indices,
    positions,
    uvs,
    instances: new Array<number>(3 * capacity).fill(-1),
    slotOffsets: [0, capacity, 2 * capacity, 3 * capacity],
    uni: { indirect: 1, drawSlot: REGION },
    shadow: { viewProjection, emitter },
  };
  const entries = shadowEntries(world),
    order = [...pages.keys()].sort(() => rng() - 0.5),
    counts = [0, 0];
  for (const row of order) {
    const cutout = (mobility.rowWords[row] & MOBILITY_CUTOUT) !== 0;
    world.instances[entries.keptAt(REGION, counts[+cutout]++, capacity, cutout)] = row;
  }
  return { world, entries, order, plain: counts[0], cutouts: counts[1], capacity };
}

/** develop's page and the split's, from the same casters. */
function bothDepths(rng: () => number, o: Options) {
  const { world, entries, order, plain, cutouts, capacity } = scene(rng, o);
  const vertexCount = Math.max(0, ...world.pages.map((page) => page.indexCount));
  const keep = (frag: ShadowOut) => entries.shadowKeep(frag, { x: 0, y: 0 }, { x: 0, y: 0 });
  // The depth-only entry returns its position alone.
  const depthOnly = (vertex: number, instance: number) =>
    ({ position: entries.shadow_depth_vs(vertex, instance) }) as ShadowOut;
  const split = rasterDepth(
    SIDE,
    vertexCount,
    [
      world.shadow.emitter.w > 0
        ? { entry: entries.shadow_vs, instances: plain, fragment: true }
        : { entry: depthOnly, instances: plain, fragment: false },
      { entry: entries.shadow_cutout_vs, instances: cutouts, fragment: true },
    ],
    keep,
  );
  // develop: one list, in the cull's own order, every caster through the fragment test.
  world.instances.fill(-1);
  order.forEach((row, rank) => (world.instances[REGION * capacity + rank] = row));
  const developVertex = (vertex: number, instance: number) =>
    entries.developVertex(vertex, instance, false);
  const develop = rasterDepth(
    SIDE,
    vertexCount,
    [{ entry: developVertex, instances: order.length, fragment: true }],
    keep,
  );
  return { develop, split, plain, cutouts };
}

test('random casters: the split draws write develop’s depth, to the bit (audit t05, 40 trials)', () => {
  const rng = mulberry32(11);
  let written = 0,
    cutouts = 0;
  for (let trial = 0; trial < 40; trial++) {
    const o = { rows: 2 + Math.floor(rng() * 40), blended: Math.floor(rng() * 3) };
    const envelope = trial % 4 === 3 ? 0.4 + rng() : 0;
    const { develop, split, cutouts: cut } = bothDepths(rng, { ...o, envelope });
    assert.deepEqual(split, develop, `trial ${trial}`);
    written += develop.filter((word) => word !== 0).length;
    cutouts += cut;
  }
  // Not vacuous: the pages hold depth, and cutout casters were drawn by their own list.
  assert.ok(written > 1000 && cutouts > 50, `${written} texels, ${cutouts} cutouts`);
});

test('edge inputs: NaN, ±0, ±Inf, subnormal in positions, matrices, uvs and dashes, as develop', () => {
  const rng = mulberry32(7);
  for (const special of HOSTILE_FLOATS)
    for (const spoil of [0.05, 0.5, 1])
      for (const envelope of [0, 0.5]) {
        const { develop, split } = bothDepths(rng, { rows: 24, special, spoil, envelope });
        assert.deepEqual(split, develop, `${special} over ${spoil}, envelope ${envelope}`);
      }
});

test('edge lists: empty, all opaque, all cutout, all blended, no corner, a full slot', () => {
  const rng = mulberry32(3);
  const cases: Array<[string, Options]> = [
    ['empty', { rows: 0 }],
    ['all opaque', { rows: 30, cutoutShare: 0 }],
    ['all cutout', { rows: 30, cutoutShare: 1 }],
    ['all blended', { rows: 12, blended: 12 }],
    ['no corner', { rows: 8, triangles: 0 }],
    ['full slot, maximal triangles', { rows: 64, triangles: 8, spare: 0 }],
    ['spare slot', { rows: 16, spare: 16 }],
  ];
  for (const [name, o] of cases) {
    const { develop, split, plain, cutouts } = bothDepths(rng, o);
    assert.deepEqual(split, develop, name);
    assert.equal(plain + cutouts, o.rows, `${name}: every row filed once`);
  }
});

// #1210: on the CPU cut, a region whose light view has no caster encodes no draw where develop drew
// its two lists at zero instances; every other region draws as develop did. Same page, to the bit.
test('a casterless region drawn with no draw writes develop’s depth, to the bit', () => {
  const rng = mulberry32(1210);
  for (const [name, o] of [
    ['cleared page', { rows: 0 }],
    ['casters in the scene, none kept', { rows: 24, envelope: 0.5 }],
  ] as Array<[string, Options]>) {
    const { world, entries } = scene(rng, o);
    const keep = (frag: ShadowOut) => entries.shadowKeep(frag, { x: 0, y: 0 }, { x: 0, y: 0 });
    const vertexCount = Math.max(0, ...world.pages.map((page) => page.indexCount));
    const developEmpty = rasterDepth(
      SIDE,
      vertexCount,
      [
        { entry: entries.shadow_vs, instances: 0, fragment: true },
        { entry: entries.shadow_cutout_vs, instances: 0, fragment: true },
      ],
      keep,
    );
    assert.deepEqual(rasterDepth(SIDE, vertexCount, [], keep), developEmpty, name);
  }
  // The regions that keep casters encode develop's draws: the split's equivalence above holds.
  const { develop, split } = bothDepths(rng, { rows: 24 });
  assert.deepEqual(split, develop);
});
