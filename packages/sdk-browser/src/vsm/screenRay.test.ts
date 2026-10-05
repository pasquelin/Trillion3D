// The projection's screen ray (`vsmScreenRayCast`) reads its four depths at once, before any test:
// the same samples and times, so the same length, as a loop that reads each sample
// after testing the one before — run here as that loop, in
// JavaScript, beside the shipped WGSL over rays and depth fields that hit at every step, miss,
// and meet the start's depth exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun, Mat } from '../texture/shaderRun.fixture.ts';
import { CODE, unit } from './pageWorld.fixture.ts';

const CLIP = new Mat([1.2, 0, 0, 0, 0, 2.1, 0, 0, 0.1, -0.05, 0, -1, 0, 0, 0.1, 0]);
const SCALE_BIAS = [0.5, -0.5, 0.5, 0.5];

/** The sequential loop: each depth read after the test of the one before. */
function sequentialCast(
  depthAt: (uv: number[]) => number,
  start: number[],
  step: number[],
  rayLength: number,
  dither: number,
) {
  const steps = 4,
    stepJitter = dither - 0.5,
    dt = 1 / steps;
  let time = stepJitter * dt + dt;
  const startDepth = depthAt(start);
  for (let i = 0; i < steps; i++) {
    const uvz = start.map((x, k) => x + step[k] * time);
    const depth = depthAt(uvz);
    if (depth !== startDepth && uvz[2] < depth) return rayLength * Math.max(0, time - 1.5 * dt);
    time += dt;
  }
  return rayLength;
}

test('the four depths read at once give the length the one-by-one reads give', () => {
  let hits = 0;
  for (let k = 0; k < 20000; k++) {
    const r = (j: number) => unit(k, j);
    // A depth field of steps: a ground and, on some rays, a wall the ray may pass behind.
    const wall = r(1) < 0.6 ? r(2) : 2,
      ground = 0.2 + 0.1 * r(3),
      near = 0.3 + 0.6 * r(4);
    const depthAt = (uv: number[]) =>
      uv[0] > wall ? near : Math.round((ground + 0.05 * uv[1]) * 64) / 64;
    const { vsmScreenRayCast } = shaderRun<{
      vsmScreenRayCast: (o: number[], d: number[], l: number, dither: number) => number;
    }>(CODE, ['vsmScreenRayCast'], {
      vsmView: { shiftedToClip: CLIP, clipToBufferUv: SCALE_BIAS },
      vsmSampleSceneDepth: depthAt,
    });
    const origin = [r(5) - 0.5, r(6) - 0.5, -2 - 3 * r(7)],
      direction = [r(8) - 0.5, r(9) - 0.5, r(10) - 0.5],
      rayLength = 0.05 + 0.5 * r(11),
      dither = r(12);
    const got = vsmScreenRayCast(origin, direction, rayLength, dither);
    // The sequential loop from the same clip-space start and step the shipped function derives.
    const clip = (v: number[], w: number) =>
      [0, 1, 2, 3].map((row) => [...v, w].reduce((s, x, col) => s + CLIP.m[col * 4 + row] * x, 0));
    const a = clip(origin, 1),
      b = clip(
        direction.map((x) => x * rayLength),
        0,
      ),
      e = a.map((x, i) => x + b[i]);
    const sa = a.slice(0, 3).map((x) => x / a[3]),
      se = e.slice(0, 3).map((x) => x / e[3]),
      st = se.map((x, i) => x - sa[i]);
    const start = [
        sa[0] * SCALE_BIAS[0] + SCALE_BIAS[3],
        sa[1] * SCALE_BIAS[1] + SCALE_BIAS[2],
        sa[2],
      ],
      step = [st[0] * SCALE_BIAS[0], st[1] * SCALE_BIAS[1], st[2]];
    const want = sequentialCast(depthAt, start, step, rayLength, dither);
    assert.equal(got, want, `ray ${k}`);
    hits += +(want < rayLength);
  }
  assert.ok(hits > 1000 && hits < 19000, `${hits} rays shortened`);
});
