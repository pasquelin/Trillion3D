import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_MATRIX4 } from '../sdk-core/index.ts';
import {
  TAA_SAMPLES,
  TAA_STILL_FRAMES,
  halton,
  jitterViewProjection,
  taaJitter,
} from './taaJitter.ts';

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
