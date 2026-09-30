import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { LAMP_SOFT_WGSL } from './lampSoftWgsl.ts';
import { PCF_TAPS_WGSL } from './shadowWgsl.ts';
import { POISSON_16 } from './pcfTaps.ts';

type V = number[];
function sample(radius: number, receiver: number, blocker: number | null, texel0 = 0.001, mip = 0) {
  const search: V[] = [],
    filter: V[] = [],
    mips = { search: new Set<number>(), filter: new Set<number>() };
  const { pointSoftShadow } = shaderRun<{ pointSoftShadow: (...args: unknown[]) => number }>(
    LAMP_SOFT_WGSL + PCF_TAPS_WGSL,
    ['pointSoftShadow', 'lampSoftDisk', 'lampSoftMip', 'lampSoftCentre'],
    {
      ...wgslConstants(LAMP_SOFT_WGSL),
      LAMP_MIP_COUNT: 6,
      shadows: { records: [{ info: [6, 1, 0.1, 0] }] },
      PCF_TAPS: POISSON_16.length,
      POISSON: POISSON_16,
      shadowTransmission: [1, 1, 1],
      LampDisk: (T: V, B: V, distance: number, closest: number, search: number) => ({
        ...{ T, B, distance },
        ...{ closest, search },
      }),
      cross: (a: V, b: V) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ],
      normalize: (a: V) => a.map((x) => x / Math.hypot(...a)),
      lampDiskSample: (
        _index: number,
        _light: unknown,
        _p: V,
        _n: V,
        delta: V,
        mip: number,
        filtering: boolean,
      ) => {
        (filtering ? filter : search).push(delta);
        mips[filtering ? 'filter' : 'search'].add(mip);
        return { distance: blocker ?? 0, blocked: blocker !== null, through: [0.5, 0.75, 1] };
      },
    },
  );
  const result = pointSoftShadow(
    0,
    { positionRange: [0, 0, 0, 100], shape: [radius, 0, 0, 0] },
    [0, 0, receiver],
    [0, 0, -1],
    0,
    texel0,
    mip,
  );
  return { result, search, filter, mips };
}

test('point PCSS has bounded existing tap count and contact-hardening from similar triangles', () => {
  const a = sample(0.5, 10, 5),
    b = sample(1, 10, 5),
    contact = sample(0.5, 5, 5);
  for (const value of [a, b, contact]) {
    assert.equal(value.result, 1);
    assert.equal(value.search.length, 16);
    assert.equal(value.filter.length, 16);
  }
  for (let i = 0; i < 16; i++) {
    const footprint = Math.hypot(...a.filter[i]);
    assert.ok(Math.abs(footprint - 0.5 * Math.hypot(...POISSON_16[i])) < 1e-12);
    assert.equal(Math.hypot(...b.filter[i]), footprint * 2);
    assert.equal(Math.hypot(...contact.filter[i]), 0);
  }
  const farther = sample(0.5, 15, 5);
  assert.ok(Math.abs(Math.hypot(...farther.filter[0]) - 2 * Math.hypot(...a.filter[0])) < 1e-12);
});

test('no blocker returns the existing PCF fallback without running the filter stage', () => {
  const value = sample(0.5, 10, null);
  assert.equal(value.result, -1);
  assert.equal(value.search.length, 16);
  assert.equal(value.filter.length, 0);
});

test('each PCSS stage reads the mip whose texels hold its disk within eight, never finer than the pixel’s', () => {
  // A finest texel of 0.1 m: the search's 9.5 m and 9 m disks read mip 4 (0.8 m, 11.9 and 11.25
  // texels at mip 3); the 0.5 m penumbra mip 0, the 1 m one mip 1 (1.25 texels at mip 0).
  const a = sample(0.5, 10, 5, 0.1),
    b = sample(1, 10, 5, 0.1);
  assert.deepEqual([...a.mips.search, ...a.mips.filter], [4, 0]);
  assert.deepEqual([...b.mips.search, ...b.mips.filter], [4, 1]);
  // Never finer than the pixel's own mip.
  assert.deepEqual([...sample(0.5, 10, 5, 0.1, 2).mips.filter], [2]);
  // A disk past the chain's last mip reads the last.
  assert.deepEqual([...sample(0.5, 10, 5).mips.search], [5]);
});
