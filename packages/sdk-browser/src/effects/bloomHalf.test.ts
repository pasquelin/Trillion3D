// #963 (OMB-16): the bloom filters in half precision where the device grants `shader-f16`, with the
// f32 path as the fallback. The candidate that keeps the sum in f32 and takes only the operands in
// half — `c+=vec4f(vec4h(tap)*h(w))` — is run tap by tap against the shipped f32 filter
// (`c+=tap*w`), on the shipped taps, and refused: a bilinear tap of an `rgba16float` level is an
// f32 blend of texels, which a half rounds (and a small half product drops bits), so levels and
// 8-bit pixels change (AGENTS.md rule 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BloomTap } from './bloomFilter.ts';
import { BLOOM_WGSL } from './bloomWgsl.ts';
import { bilinear, f16, tapsOf, type Image } from './bloom.fixture.ts';
import { linearToSrgb8 } from '../../../sdk-core/src/math/primitives/color.ts';
import { mulberry32 } from '../../../../site/examples/kit/random.ts';

const shipped = (from: string, to: string) =>
  tapsOf(BLOOM_WGSL.slice(BLOOM_WGSL.indexOf(from), BLOOM_WGSL.indexOf(to)));
const DOWN = shipped('fn down(', 'fn up(');
const TENT = shipped('fn tent(', 'fn blendLevel(');
const bits = (x: number) => new Uint32Array(Float32Array.of(x).buffer)[0];

/** A level of `rgba16float` texels, one channel: every value a half. */
const level = (w: number, values: () => number): Image => ({
  data: Float64Array.from({ length: w * w }, () => f16(values())),
  w,
  h: w,
});

/**
 * One pass into an `ow`-wide target, both ways: the shipped f32 sum of f32 products, and the
 * candidate's f32 sum of half products of half operands. Each tap is read once, by a filter at
 * best exact (`bilinear` in f64, then f32), and handed to both, so only the arithmetic differs.
 */
function pass(from: Image, ow: number, taps: readonly BloomTap[], stride: number) {
  const out: { f32: number; half: number; rounded: number; underflow: number }[] = [];
  for (let j = 0; j < ow; j++)
    for (let i = 0; i < ow; i++) {
      const x = ((i + 0.5) * from.w) / ow,
        y = ((j + 0.5) * from.h) / ow;
      let f32 = 0,
        half = 0,
        rounded = 0,
        underflow = 0;
      for (const [dx, dy, w] of taps) {
        const tap = Math.fround(bilinear(from, x + dx * stride, y + dy * stride));
        f32 = Math.fround(f32 + Math.fround(tap * w));
        half = Math.fround(half + f16(f16(tap) * w));
        if (!Object.is(f16(tap), tap)) rounded++;
        else if (!Object.is(f16(tap * w), tap * w)) underflow++;
      }
      out.push({ f32, half, rounded, underflow });
    }
  return out;
}
/** Stored texels that differ between the two ways, as the level's `rgba16float` holds them. */
const storedDiffs = (texels: ReturnType<typeof pass>) =>
  texels.filter(({ f32, half }) => !Object.is(f16(f32), f16(half)));

const random = mulberry32(16);
const magnitudes = () => (random() < 0.2 ? -1 : 1) * 2 ** (random() * 60 - 36);
const EDGES = [NaN, 0, -0, Infinity, -Infinity, 2 ** -24, -(2 ** -20), 2 ** -14, 65504, -65504];
const edge = () => EDGES[Math.floor(random() * EDGES.length)];
const display = () => random();
const PASSES = [
  { name: 'down', taps: DOWN, stride: 1, scale: 0.5 },
  { name: 'tent, radius 1', taps: TENT, stride: 1, scale: 2 },
  { name: 'tent, radius 0.85', taps: TENT, stride: 0.85, scale: 2 },
];

test('the shipped taps are powers of two: an f32 product of a tap is exact', () => {
  for (const [, , w] of [...DOWN, ...TENT]) assert.equal(2 ** Math.round(Math.log2(w)), w);
});

test('an empty level filters to the same zeros both ways', () => {
  for (const { taps, stride, scale } of PASSES) {
    const from = level(8, () => 0);
    for (const texel of pass(from, 8 * scale, taps, stride))
      assert.equal(bits(texel.half), bits(texel.f32));
  }
});

test('half operands round the bilinear taps and change stored levels (OMB-16 refused)', () => {
  for (const { name, taps, stride, scale } of PASSES)
    for (const values of [magnitudes, edge, display]) {
      const texels = pass(level(32, values), 32 * scale, taps, stride),
        diffs = storedDiffs(texels);
      // Every difference has its cause: a tap no half holds, or a half product under 2⁻¹⁴ that
      // drops bits; a tap a half holds, times a power of two in the normal range, is exact.
      for (const { rounded, underflow } of diffs)
        assert.ok(rounded + underflow > 0, `${name}: exact taps differ`);
      if (values === display) assert.ok(diffs.length > 0, `${name}: some stored texel changes`);
    }
});

test('the changed levels flip 8-bit pixels of a glow shown as it is', () => {
  const texels = pass(level(128, display), 64, DOWN, 1);
  const flips = texels.filter(
    ({ f32, half }) => linearToSrgb8(f16(f32)) !== linearToSrgb8(f16(half)),
  );
  assert.ok(flips.length > 0, 'a flipped pixel is an image loss');
});
