// #991: a sun page drawn in the current depth range reads as develop did, one reference for all;
// a page of an older range reads at `sunRangeReference`, as develop would have in that range; a
// neighbour page of another range is never read. The shipped WGSL runs, vectors and all, over
// seeded random sun frames, receivers, ranges and page tables, and their edge cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUN_DEPTH_RANGES,
  SUN_LEVELS,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import {
  CONSTANTS,
  DEVELOP_SHADOW_NEIGHBOUR,
  DEVELOP_SUN_SHADOW_FACTOR,
  SHADOW_WGSL,
  pageTable,
  pageWord,
  rangeReference,
  sunRead,
  sunRecord,
  type Sun,
  type Vec3,
} from './sunRangeRead.fixture.ts';

const { SHADOW_DEPTH_ROUNDING: ROUNDING, SHADOW_PAST_FAR: PAST_FAR } = CONSTANTS;
const DEVELOP = DEVELOP_SUN_SHADOW_FACTOR + SHADOW_WGSL;
/** A slot other than `slot`, from `h` in [0, 1). */
const olderSlot = (slot: number, h: number) =>
  (slot + 1 + Math.floor(h * (SUN_DEPTH_RANGES - 1))) % SUN_DEPTH_RANGES;
const SLOTS = [0, 1, 7, 8, 9, SUN_DEPTH_RANGES - 2, SUN_DEPTH_RANGES - 1];

const unit = (v: Vec3): Vec3 => v.map((x) => x / Math.hypot(...v)) as Vec3;
const cross = ([a, b, c]: Vec3, [x, y, z]: Vec3): Vec3 => [
  b * z - c * y,
  c * x - a * z,
  a * y - b * x,
];
/** `Σ kᵢ·vᵢ`. */
const sum = (...terms: Array<[number, Vec3]>) =>
  [0, 1, 2].map((i) => terms.reduce((s, [k, v]) => s + k * v[i], 0)) as Vec3;

/** A seeded orthonormal frame, no vector along an axis of the world. */
function frameOf(r: () => number): Sun['frame'] {
  const axis = unit([r() - 0.5, r() - 0.5, r() - 0.5].map((x) => x + 0.1) as Vec3);
  const right = unit(cross(axis, unit([r() + 0.2, r() - 0.5, r() + 0.1])));
  return [right, cross(axis, right), axis];
}

/** A sun of seeded ranges — a tenth of them empty, `zNear = zFar` — and a receiver and pixel
 *  about its current range, the first cases on the edges: slots, footprints, incidences. */
function cases(seed: number, count: number) {
  const r = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => {
    const ranges = Array.from({ length: SUN_DEPTH_RANGES }, (): [number, number] => {
      const near = -60 + r() * 40;
      return [near, near + (r() < 0.1 ? 0 : r() * 120)];
    });
    const current = i < SLOTS.length ? SLOTS[i] : Math.floor(r() * SUN_DEPTH_RANGES);
    const sun: Sun = {
      ranges,
      current,
      levels: 1 + Math.floor(r() * SUN_LEVELS),
      finest: Math.floor(r() * 11) - 6,
      tableBase: Math.floor(r() * 4096),
      frame: frameOf(r),
    };
    const [right, up, axis] = sun.frame,
      [near, far] = ranges[current];
    // Incidence cosines: facing, grazing, nearly grazing, back-facing, then random.
    const cosine = i < 8 ? [1, 0, 1e-4, -0.5][i % 4] : r() * 1.3 - 0.3,
      turn = r() * 2 * Math.PI,
      across = sum([Math.cos(turn), right], [Math.sin(turn), up]);
    const footprints = [0, 1e-30, 1e30, 2 ** -6, 1];
    return {
      sun,
      seed: Math.floor(r() * 2 ** 31),
      at: {
        P: sum(
          [near + (far - near) * (r() * 1.4 - 0.2), axis],
          [r() * 100 - 50, right],
          [r() * 100 - 50, up],
        ),
        N: sum([-cosine, axis], [Math.sqrt(1 - cosine * cosine), across]),
        footprint: i < 20 ? footprints[i % 5] : 2 ** (r() * 16 - 8),
        taps: i % 5 !== 3,
      },
    };
  });
}

test("a page drawn in the current range reads develop's one reference (#991)", () => {
  const answers = { pcf: 0, far: 0 };
  for (const { sun, seed, at } of cases(991, 600)) {
    const record = sunRecord(sun);
    for (const empty of [0, 0.3, 0.9, 1]) {
      const table = pageTable(seed, empty, () => sun.current);
      const shipped = sunRead(SHADOW_WGSL, record, table, at),
        before = sunRead(DEVELOP, record, table, at);
      assert.deepEqual(shipped, before, `slot ${sun.current}, ${JSON.stringify(at)}`);
      assert.equal(shipped.ranged.length, 0, 'no second reference in the current range');
      assert.equal(shipped.pcf.length + shipped.far.length, 1, 'one read answers');
      answers.pcf += shipped.pcf.length;
      answers.far += shipped.far.length;
    }
  }
  assert.ok(answers.pcf > 1000 && answers.far > 600, JSON.stringify(answers));
});

test('a page of an older range reads at sunRangeReference, as develop in that range (#991)', () => {
  let floored = 0,
    read = 0;
  for (const { sun, seed, at } of cases(1167, 600)) {
    const table = pageTable(seed, 0.3, (h) => olderSlot(sun.current, h));
    const shipped = sunRead(SHADOW_WGSL, sunRecord(sun), table, at);
    if (!shipped.pcf.length) continue;
    read++;
    assert.equal(shipped.ranged.length, 1, 'the older page takes its own reference');
    const [index, drawn, z, reference] = shipped.ranged[0];
    assert.equal(index, 0);
    assert.notEqual(drawn, sun.current);
    const [pcf] = shipped.pcf;
    assert.equal(pcf[2], reference, 'the PCF compares at the older range’s reference');
    // Develop, had that range been current: the same page, texel and taps at its reference.
    const before = sunRead(DEVELOP, sunRecord({ ...sun, current: drawn }), table, at);
    assert.deepEqual(
      [...pcf.slice(0, 2), ...pcf.slice(3)],
      [...before.pcf[0].slice(0, 2), ...before.pcf[0].slice(3)],
    );
    const past = before.pcf[0][2] as number,
      [near, far] = sun.ranges[drawn].map(Math.fround);
    if (past <= PAST_FAR) {
      floored++;
      assert.equal(reference, PAST_FAR, 'past the far side: above the far clear');
    } else {
      const scale = (Math.abs(z) + Math.abs(near) + 1) / Math.max(far - near, 1e-6);
      assert.ok(Math.abs(reference - past) <= 1e-12 * scale, `${reference} vs ${past}`);
    }
  }
  assert.ok(read > 200 && floored > 0, `${read} older pages read, ${floored} past their range`);
});

test('sunRangeReference reads the slot the record pack wrote, floored past its far side', () => {
  const r = mulberry32(8),
    ranges = Array.from({ length: SUN_DEPTH_RANGES }, (_, slot): [number, number] => {
      const near = -50 + r() * 100;
      return [near, slot % 11 === 5 ? near : near + 1 + r() * 200];
    });
  const sun = { ranges, current: 0, levels: 1, finest: 0, tableBase: 0, frame: frameOf(r) };
  const reference = rangeReference(sunRecord(sun));
  for (let slot = 0; slot < SUN_DEPTH_RANGES; slot++) {
    const [near, far] = ranges[slot].map(Math.fround);
    assert.equal(reference(0, slot, near), 1 + ROUNDING, `slot ${slot}: its near side`);
    assert.ok(reference(0, slot, near - 1) > 1 + ROUNDING, `slot ${slot}: before its near side`);
    assert.equal(reference(0, slot, far + 1), PAST_FAR, `slot ${slot}: past its far side`);
    if (far > near) {
      assert.ok(Math.abs(reference(0, slot, far) - ROUNDING) < 1e-12, `slot ${slot}: far`);
      const mid = reference(0, slot, (near + far) / 2);
      assert.ok(Math.abs(mid - 0.5 - ROUNDING) < 1e-12, `slot ${slot}: halfway`);
    } else assert.equal(reference(0, slot, near + 1e-3), PAST_FAR, `slot ${slot}: empty range`);
  }
});

test('a neighbour page is read only in the home page’s range, as develop read it (#991)', () => {
  type Neighbour = { shadowNeighbour: (...args: unknown[]) => number[] };
  const r = mulberry32(456);
  let word = 0;
  const scope = {
    ...CONSTANTS,
    shadowPageWord: () => word,
    shadowOffset: (w: number, [x, y]: number[]) => [(w & 0xffff) * 128, x * 128, y],
  };
  const [shipped, before] = [SHADOW_WGSL, DEVELOP_SHADOW_NEIGHBOUR].map(
    (source) => shaderRun<Neighbour>(source, ['shadowNeighbour'], scope).shadowNeighbour,
  );
  for (let i = 0; i < 2000; i++) {
    const slot = SLOTS[i % SLOTS.length],
      other = r() < 0.5 ? slot : olderSlot(slot, r()),
      homeWord = pageWord(Math.floor(r() * 65536), slot),
      home = [r() * 4096, r() * 4096, Math.floor(r() * 8)],
      page = [Math.floor(r() * 64) - 32, Math.floor(r() * 64) - 32];
    word = r() < 0.2 ? 0 : pageWord(Math.floor(r() * 65536), other);
    const read = shipped(null, page, home, homeWord);
    if (word && other !== slot)
      assert.deepEqual(read, [...home, 0], 'another range: the home page');
    else assert.deepEqual(read, before(null, page, home), 'the same range or none');
  }
});
