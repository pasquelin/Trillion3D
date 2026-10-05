// The tile's box with subgroups (`vsmTileBound`, `projectionWgsl.ts`): each subgroup joins its
// lanes' held bits and keys by `subgroupMax`, and its first lane alone joins the group's words. The
// shipped function runs here lane by lane at subgroup sizes 4 to 64, each `subgroupMax` answered
// from the arguments its subgroup's lanes gave at the same call, on generated tiles — lit, sky,
// mixed, a point not finite —: the group's words are those every lane joining them alone gives
// (the variant without subgroups).
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { vsmLayout } from './resources.ts';
import { vsmProjectionWgsl } from './projectionWgsl.ts';
import { CASES, SCOPE, pixelsOf, type Pixel } from './projectionTiles.fixture.ts';
import { seeded } from './planFrames.fixture.ts';

const LAYOUT = vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }, 2 ** 27);
type Bound = (valid: boolean, p: number[], lane: number) => void;

/** The group's words after every lane of `pixels` joined them through `code`'s `vsmTileBound`, the
 *  lanes in subgroups of `size` (`size` 1: no subgroup operation). */
function groupWords(code: string, pixels: Pixel[], size: number) {
  const words = { vsmTileBounds: [0, 0, 0, 0, 0, 0], vsmTileHeld: 0 };
  const max = (a: number | number[], b: number | number[]) =>
    Array.isArray(a) ? a.map((x, i) => Math.max(x, (b as number[])[i])) : Math.max(a, b as number);
  // Each lane's arguments, call by call: recorded on a first turn, answered on the second.
  const asked: (number | number[])[][] = pixels.map(() => []);
  let replay = false,
    lane = 0,
    call = 0;
  const subgroupMax = (v: number | number[]) => {
    const k = call++;
    if (!replay) return (asked[lane][k] = v);
    const first = lane - (lane % size);
    let out = asked[first][k];
    for (let other = first + 1; other < first + size; other++) out = max(out, asked[other][k]);
    return out;
  };
  const { vsmTileBound } = shaderRun<{ vsmTileBound: Bound }>(
    code,
    ['vsmTileBound', 'vsmOrderedKey'],
    {
      ...SCOPE,
      ...words,
      subgroupMax,
      atomicOr: (p: { get: () => number; set: (v: number) => void }, v: number) =>
        replay ? p.set((p.get() | v) >>> 0) : undefined,
      atomicMax: (p: { get: () => number; set: (v: number) => void }, v: number) =>
        replay ? p.set(Math.max(p.get(), v)) : undefined,
    },
  );
  for (replay of [false, true])
    for (lane = 0; lane < pixels.length; lane++) {
      call = 0;
      const p = pixels[lane];
      vsmTileBound(p.info.valid, p.shifted, lane % size);
    }
  return words;
}

test('a subgroup joins its lanes first, its first lane the group: the same words at any size', () => {
  const withSubgroups = vsmProjectionWgsl(LAYOUT, { subgroups: true }),
    without = vsmProjectionWgsl(LAYOUT, { subgroups: false });
  assert.ok(withSubgroups.includes('held=subgroupMax(held);'));
  const rand = seeded(77);
  for (let round = 0; round < 42; round++) {
    const pixels = pixelsOf(rand, [round, 0], CASES[round % CASES.length]);
    const alone = groupWords(without, pixels, 1);
    for (const size of [4, 8, 16, 32, 64])
      assert.deepEqual(groupWords(withSubgroups, pixels, size), alone, `round ${round}, ${size}`);
  }
});
