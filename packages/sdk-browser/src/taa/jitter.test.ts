import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import {
  TAA_SAMPLES,
  taaStillFrames,
  jitterViewProjection,
  taaJitter,
  upscaleMipBias,
  upscalePhases,
} from './jitter.ts';
import { renderExtent } from '../frame/renderScaleOption.ts';
import { halton } from '../../../sdk-core/src/math/primitives/halton.ts';

test('the Halton sequence starts with the known terms and stays in [0, 1)', () => {
  assert.deepEqual(
    [1, 2, 3, 4].map((i) => halton(i, 2)),
    [0.5, 0.25, 0.75, 0.125],
  );
  assert.deepEqual(
    [1, 2, 3].map((i) => halton(i, 3)),
    [1 / 3, 2 / 3, 1 / 9],
  );
  for (let i = 1; i < 200; i++) {
    assert.ok(halton(i, 2) >= 0 && halton(i, 2) < 1);
    assert.ok(halton(i, 3) >= 0 && halton(i, 3) < 1);
  }
});

test('a prime number of distinct jitters, centred in the pixel, deterministic and cyclic', () => {
  assert.equal(TAA_SAMPLES, 11, 'eleven at native size: eight positions raised to a prime');
  const out = new Float64Array(2),
    views = new Set<string>();
  let sx = 0,
    sy = 0;
  for (let sample = 0; sample < TAA_SAMPLES; sample++) {
    const [x, y] = taaJitter(sample, out);
    assert.ok(Math.abs(x) < 0.5 && Math.abs(y) < 0.5, `jitter ${sample} outside the pixel`);
    views.add(`${x},${y}`);
    sx += x;
    sy += y;
  }
  assert.equal(views.size, TAA_SAMPLES, 'two frames of the cycle share a position');
  // The cycle mean stays near the centre: no bias to one side of the pixel.
  assert.ok(Math.abs(sx / TAA_SAMPLES) < 0.1 && Math.abs(sy / TAA_SAMPLES) < 0.1);
  // The same rank yields the same jitter, and the cycle closes: that is what makes two runs
  // identical and the A/A witness possible.
  assert.deepEqual([...taaJitter(3, out)], [...taaJitter(3 + TAA_SAMPLES, new Float64Array(2))]);
  // A hold closes a whole number of cycles, the first with 64 draws: six cycles of eleven.
  assert.equal(taaStillFrames(TAA_SAMPLES), 6 * TAA_SAMPLES);
});

test('a still hold is a whole number of cycles of at least 64 images, at every phase count', () => {
  for (const [phases, frames] of [
    [11, 66],
    [17, 68],
    [19, 76],
    [37, 74],
    [131, 131],
  ]) {
    assert.equal(taaStillFrames(phases), frames, `${phases} phases`);
    assert.equal(frames % phases, 0);
    assert.ok(frames >= 64);
  }
});

test('jitter is a translation in clip space, zero when the offset is zero', () => {
  const vp = new Float64Array(16);
  for (let i = 0; i < 16; i++) vp[i] = i + 1;
  const out = new Float64Array(16);
  jitterViewProjection(out, vp, 0, 0, 640, 480);
  assert.deepEqual([...out], [...vp], 'zero jitter must return the matrix to the bit');
  jitterViewProjection(out, vp, 0.25, -0.5, 640, 480);
  for (let column = 0; column < 4; column++) {
    const at = column * 4,
      w = vp[at + 3];
    assert.equal(out[at], vp[at] + ((2 * 0.25) / 640) * w);
    assert.equal(out[at + 1], vp[at + 1] + ((2 * -0.5) / 480) * w);
    assert.equal(out[at + 2], vp[at + 2]);
    assert.equal(out[at + 3], w);
  }
  // A clip point (0, 0, z, 1) shifted by a quarter pixel lands at 2·0.25/640 in NDC: half
  // a pixel of width is 2/640, a quarter is half of that.
  jitterViewProjection(out, IDENTITY_MATRIX4, 0.25, 0.25, 640, 480);
  assert.equal(out[12], (2 * 0.25) / 640);
  assert.equal(out[13], (2 * 0.25) / 480);
});

// #816: the boss's display, drawn at 67 % and 50 % per axis, reconstructed to it.
test('jitter phases follow the render-to-display ratio, a prime, distinct and stratified at every scale', () => {
  const display = 3456;
  assert.equal(upscalePhases(display, display), TAA_SAMPLES, 'eleven at native size');
  assert.equal(upscalePhases(4000, display), TAA_SAMPLES, 'eleven above it');
  // 8 · (display / render)², rounded, then the next prime from eleven: 11, 17 and 37.
  for (const [scale, expected] of [
    [0.75, 17],
    [0.67, 19],
    [0.5, 37],
  ]) {
    const phases = upscalePhases(renderExtent(display, scale), display);
    assert.equal(phases, expected, `${phases} phases at ${scale}`);
    const out = new Float64Array(2),
      seen = new Set<string>(),
      quadrants = [0, 0, 0, 0];
    for (let sample = 0; sample < phases; sample++) {
      const [x, y] = taaJitter(sample, out, phases);
      assert.ok(Math.abs(x) < 0.5 && Math.abs(y) < 0.5, 'inside the render pixel');
      seen.add(`${x},${y}`);
      quadrants[(x < 0 ? 0 : 1) + (y < 0 ? 0 : 2)]++;
    }
    assert.equal(seen.size, phases, 'no two phases share a position');
    // Stratified: each half of the render pixel across gets its half to one (base 2), each quarter
    // — a display pixel at half scale — its share to two (base 3 splits in thirds, not halves).
    assert.ok(Math.abs(quadrants[0] + quadrants[2] - phases / 2) <= 1, `${quadrants}`);
    for (const count of quadrants) assert.ok(Math.abs(count - phases / 4) <= 2, `${quadrants}`);
  }
});

test('the texture level offset is zero at native size and log2 of the scale below it', () => {
  assert.equal(upscaleMipBias(3456, 3456), 0);
  assert.equal(upscaleMipBias(1728, 3456), -1);
  assert.equal(upscaleMipBias(2312, 3456), Math.log2(2312 / 3456));
});
