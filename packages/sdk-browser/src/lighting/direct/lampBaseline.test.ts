import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun, Mat } from '../../texture/shaderRun.fixture.ts';
import { SHADOW_FACTOR_WGSL } from './shadowFactorWgsl.ts';

test('zero-radius lamps retain exactly the baseline PCF call; spot and request-only paths do too', () => {
  const pcf: unknown[][] = [];
  let softCalls = 0;
  const identity = Object.assign(new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), {
    0: [1, 0, 0, 0],
    1: [0, 1, 0, 0],
    2: [0, 0, 1, 0],
    3: [0, 0, 0, 1],
  });
  const record = { info: [6, 1, 0.1, 0], faces: Array(6).fill(identity) };
  const { lampShadowFactor } = shaderRun<{ lampShadowFactor: (...args: unknown[]) => number }>(
    SHADOW_FACTOR_WGSL,
    ['lampShadowFactor'],
    {
      shadows: { records: [record] },
      shadowFootprint: 0.01,
      LAMP_MIP_COUNT: 1,
      SHADOW_DEPTH_ROUNDING: 0,
      shadowNormalTexels: () => 0,
      shadowDepthMargin: () => 0,
      shadowLampFinestTexel: () => 0.01,
      shadowLampReadMip: () => 0,
      // The shading's one lookup (`SHADOW_READ_AT_WGSL`): a point inside face 0.
      lampReadAt: () => ({
        at: { map: [0], t: [512, 512], home: [4, 4], Q: [0, 0, 0.5], texel: 0.01 },
        clip: [0, 0, 0.5, 1],
        ndc: [0, 0, 0.5],
        face: 0,
        side: 1024,
        inside: true,
      }),
      shadowPageWord: () => 1,
      pointSoftShadow: () => {
        softCalls++;
        return 1;
      },
      shadowPcf: (...args: unknown[]) => {
        pcf.push(args);
        return 0.375;
      },
      select: (a: unknown, b: unknown, condition: boolean) => (condition ? b : a),
    },
  );
  const light = { positionRange: [0, 0, 0, 10], shape: [0, 0, 0, 0] };
  const run = (taps: boolean) =>
    lampShadowFactor(0, light, [0, 0, 0.5], [0, 0, 1], [0, 0, 1], taps);
  assert.equal(run(true), 0.375);
  const baseline = pcf[0];
  assert.equal(run(true), 0.375);
  assert.deepEqual(pcf[1], baseline);
  assert.equal(softCalls, 0);
  light.shape[0] = 0.5;
  assert.equal(run(false), 0.375);
  assert.equal(softCalls, 0, 'page requests never pay the PCSS filter');
  record.info[0] = 1;
  assert.equal(run(true), 0.375);
  assert.equal(softCalls, 0, 'spot lights keep the existing PCF path');
  record.info[0] = 6;
  assert.equal(run(true), 1);
  assert.equal(softCalls, 1, 'only a positive point-light radius enters PCSS');
});
