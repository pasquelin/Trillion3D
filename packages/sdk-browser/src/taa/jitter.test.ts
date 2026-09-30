import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import {
  TAA_SAMPLES,
  jitterViewProjection,
  taaJitter,
  upscaleMipBias,
  upscalePhases,
} from './jitter.ts';
import { taaStillFrames } from './jitter.ts';
import { renderExtent } from '../frame/renderScaleOption.ts';

const TAA_STILL_FRAMES = taaStillFrames(TAA_SAMPLES);

test('eight distinct jitters, centred in the pixel, deterministic and cyclic', () => {
  const out = new Float64Array(2),
    vues = new Set<string>();
  let sx = 0,
    sy = 0;
  for (let sample = 0; sample < TAA_SAMPLES; sample++) {
    const [x, y] = taaJitter(sample, out);
    assert.ok(Math.abs(x) < 0.5 && Math.abs(y) < 0.5, `jitter ${sample} outside the pixel`);
    vues.add(`${x},${y}`);
    sx += x;
    sy += y;
  }
  assert.equal(vues.size, TAA_SAMPLES, 'two frames of the cycle share a position');
  // The cycle mean stays near the centre: no bias to one side of the pixel.
  assert.ok(Math.abs(sx / TAA_SAMPLES) < 0.1 && Math.abs(sy / TAA_SAMPLES) < 0.1);
  // The same rank yields the same jitter, and the cycle closes: that is what makes two runs
  // identical and the A/A witness possible.
  assert.deepEqual([...taaJitter(3, out)], [...taaJitter(3 + TAA_SAMPLES, new Float64Array(2))]);
  assert.equal(TAA_STILL_FRAMES, 2 * TAA_SAMPLES);
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
test('jitter phases follow the render-to-display ratio, distinct and stratified at every scale', () => {
  const display = 3456;
  assert.equal(upscalePhases(display, display), TAA_SAMPLES, 'eight at native size, as before');
  for (const [scale, expected] of [
    [0.67, 17],
    [0.5, 32],
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
    // Stratified: each quarter of the render pixel — a display pixel at half scale — gets its share.
    for (const count of quadrants) assert.ok(Math.abs(count - phases / 4) <= 1, `${quadrants}`);
  }
});

test('the texture level offset is zero at native size and log2 of the scale below it', () => {
  assert.equal(upscaleMipBias(3456, 3456), 0);
  assert.equal(upscaleMipBias(1728, 3456), -1);
  assert.equal(upscaleMipBias(2312, 3456), Math.log2(2312 / 3456));
});
