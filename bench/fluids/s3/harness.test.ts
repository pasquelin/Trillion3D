import assert from 'node:assert/strict';
import test from 'node:test';
import { fixedClock } from './clock.ts';
import { canvasDimensions, s3Cases, validateOptions } from './matrix.ts';
import { rippleInputs, smokeCamera } from './inputs.ts';
import { recordGpuSample } from './samples.ts';
import type { S3Options, S3Result } from './contracts.ts';
import type { GpuTimingSample } from '../../../packages/sdk-browser/src/gpu/timing/types.ts';

const options: S3Options = {
  case: s3Cases()[0],
  enabled: true,
  width: 1280,
  height: 720,
  warmup: 2,
  frames: 60,
};

test('S3 enumerates both ripple backends and the requested volume costs without selecting tiers', () => {
  const cases = s3Cases();
  assert.equal(cases.length, 32);
  assert.equal(new Set(cases.map((entry) => JSON.stringify(entry))).size, 32);
  for (const candidate of cases) validateOptions({ ...options, case: candidate });
  assert.equal(cases.filter((entry) => entry.backend === 'webgl2').length, 8);
  assert.throws(() => validateOptions({ ...options, frames: Infinity }), RangeError);
  assert.throws(() => validateOptions({ ...options, warmup: -1 }), RangeError);
  assert.throws(
    () =>
      validateOptions({
        ...options,
        case: { ...cases[0], rate: 60 } as unknown as S3Options['case'],
      }),
    RangeError,
  );
  assert.deepEqual(canvasDimensions(1280, 720, 2), [2560, 1440]);
  assert.throws(() => canvasDimensions(4096, 4096, 2), RangeError);
  assert.throws(() => canvasDimensions(1280, 720, NaN), RangeError);
});

test('fixed clocks preserve thirty and fifteen steps per second and bound catch-up after stalls', () => {
  for (const rate of [30, 15, 7.5]) {
    for (const refresh of [60, 120]) {
      const clock = fixedClock(rate);
      let total = 0;
      for (let frame = 0; frame < refresh * 2; frame++) total += clock.advance(1 / refresh);
      assert.equal(total, rate * 2);
      assert.equal(clock.dropped, 0);
    }
  }
  const stalled = fixedClock(30);
  assert.equal(stalled.advance(2), 4);
  assert.equal(stalled.dropped, 56);
  assert.equal(stalled.advance(0), 0);
  assert.equal(stalled.advance(1 / 30), 1);
  assert.throws(() => stalled.advance(-1), RangeError);
});

test('shared ripple impulses are bounded and balanced, camera maps smoke coverage directly', () => {
  assert.equal(rippleInputs(0).splats.length, 0);
  const input = rippleInputs(64);
  assert.equal(input.splats.length, 64);
  assert.equal(
    input.splats.reduce((sum, splat) => sum + splat[3], 0),
    0,
  );
  assert.deepEqual(input.splats[0], [-14, -14, 1.5, 0.001]);
  assert.deepEqual(input.splats[63], [14, 14, 1.5, -0.001]);
  const { viewProjection: m, inverseViewProjection: inverse } = smokeCamera();
  for (const coverage of [0.0625, 0.25, 0.5, 1]) {
    const half = Math.sqrt(coverage);
    const width = (2 * half * m[0]) / 2,
      height = (2 * half * m[5]) / 2;
    assert.ok(Math.abs(width * height - coverage) < 1e-12);
  }
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      let value = 0;
      for (let k = 0; k < 4; k++) value += m[k * 4 + r] * inverse[c * 4 + k];
      assert.ok(Math.abs(value - Number(r === c)) < 1e-6);
    }
});

test('GPU evidence records only valid measured frame envelopes, never summed pass cost', () => {
  const result = { options, gpuFrameMs: [] } as unknown as S3Result;
  const sample: GpuTimingSample = {
    frame: 2,
    frameMs: 4,
    submittedMs: 4,
    hostGapMs: 0,
    totalMs: 9,
    passes: [],
    truncated: false,
  };
  recordGpuSample(result, sample);
  recordGpuSample(result, { ...sample, frame: 1 });
  recordGpuSample(result, { ...sample, frame: 62 });
  recordGpuSample(result, { ...sample, truncated: true });
  recordGpuSample(result, { ...sample, error: 'device lost' });
  recordGpuSample(result, { ...sample, frameMs: NaN });
  recordGpuSample(result, { ...sample, frameMs: null });
  assert.deepEqual(result.gpuFrameMs, [{ frame: 0, ms: 4 }]);
});
