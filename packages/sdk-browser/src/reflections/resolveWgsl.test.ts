import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun, Mat } from '../texture/shaderRun.fixture.ts';
import {
  REFLECTION_CHANGE_WEIGHT,
  REFLECTION_FILTER_RADIUS,
  REFLECTION_HISTORY_WEIGHT,
  REFLECTION_MOVING_WEIGHT,
  REFLECTION_RESOLVE_WGSL,
} from './resolveWgsl.ts';

function fixture() {
  const samples: Record<string, number | number[] | ((at: number[]) => number | number[])> = {
    ids: [0x107, 0, 0, 0],
    sampleColor: [2, 4, 6, 1],
    depth: 0.5,
    normalRough: [0, 0, 1, 0.5],
    previousIds: [0x107, 0, 0, 0],
    previousNormal: [0, 0, 1, 0.5],
    previousDepth: 0.5,
    historyColor: [10, 20, 30, 3],
  };
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const view = {
    prevViewProj: identity,
    invViewProj: identity,
    viewport: [8, 8, 1 / 8, 1 / 8],
    params: [1, REFLECTION_HISTORY_WEIGHT, 0, 0],
  };
  const motion = [identity];
  const uv = [0.5, 0.5, 1];
  const { resolveRoughReflection } = shaderRun<{
    resolveRoughReflection: (pixel: number[]) => number[];
  }>(
    REFLECTION_RESOLVE_WGSL,
    [
      'resolveRoughReflection',
      'previousDepthOf',
      'pointAt',
      'roughSamples',
      'reflectionPhase',
      'placementOf',
    ],
    {
      ...Object.fromEntries(Object.keys(samples).map((key) => [key, key])),
      view,
      motion,
      pages: [{ placement: 0 }],
      previousUv: () => uv,
      dpdx: () => 0,
      dpdy: () => 0,
      // Pixel (4, 4) at phase 0 was traced by the half-resolution texel (2, 2) alone. A sample
      // given as a function reads the pixel.
      textureLoad: (name: string, at: number[]) => {
        const value = samples[name];
        if (name === 'sampleColor' && !traced.some((q) => q[0] === at[0] && q[1] === at[1]))
          return [0, 0, 0, 0];
        return typeof value === 'function' ? value(at) : value;
      },
    },
  );
  const traced = [[2, 2]];
  return {
    samples,
    view,
    uv,
    motion,
    traced,
    resolve: () => resolveRoughReflection([4, 4, 0, 1]),
  };
}

test('the shipped resolve combines weighted radiance and preserves zero-weight samples', () => {
  const f = fixture();
  assert.deepEqual(f.resolve(), [8, 16, 24, 4]);
  f.samples.sampleColor = [0, 0, 0, 0];
  assert.deepEqual(f.resolve(), [10, 20, 30, 3]);
  f.samples.historyColor = [0, 0, 0, 0];
  assert.deepEqual(f.resolve(), [0, 0, 0, 0]);
  f.samples.historyColor = [32000, 32000, 32000, 64];
  f.samples.sampleColor = [64000, 64000, 64000, 1];
  const value = f.resolve();
  assert.equal(value[3], 64);
  assert.equal(value[0], 32000 + 32000 / 65);
});

test('first image, disocclusion, other identities and changed lobes reject stale history immediately', () => {
  const changes = [
    (f: ReturnType<typeof fixture>) => {
      f.view.params[0] = 0;
    },
    (f: ReturnType<typeof fixture>) => {
      f.uv[2] = 0;
    },
    (f: ReturnType<typeof fixture>) => {
      f.samples.previousIds = [8, 0, 0, 0];
    },
    (f: ReturnType<typeof fixture>) => {
      f.samples.previousDepth = 0.6;
    },
    (f: ReturnType<typeof fixture>) => {
      f.samples.previousNormal = [0, 1, 0, 0.5];
    },
    (f: ReturnType<typeof fixture>) => {
      f.samples.previousNormal = [0, 0, 1, 0.6];
    },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    assert.deepEqual(f.resolve(), [2, 4, 6, 1]);
  }
  const f = fixture();
  f.samples.ids = [0, 0, 0, 0];
  assert.deepEqual(f.resolve(), [0, 0, 0, 0]);
});

test('#1346: the texels around a pixel are filtered by a tent of distance, on its receiver, lobe and plane', () => {
  const f = fixture();
  f.samples.historyColor = [0, 0, 0, 0];
  // Owners (2, 2), (4, 2), (2, 4) and (6, 6) around (4, 4); the radius at roughness 0.5 is 3.
  f.traced.push([1, 1], [2, 1], [1, 2], [3, 3]);
  const tent = (distance: number) => 1 - distance / (REFLECTION_FILTER_RADIUS * 1.5);
  const weight = 1 + 2 * tent(2) + 2 * tent(2 * Math.SQRT2);
  const near = (value: number[], expected: number[]) =>
    value.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9, `${value} ~ ${expected}`));
  near(f.resolve(), [2, 4, 6, weight]);
  // An owner off the pixel's plane (a step of the same receiver) is another surface.
  f.samples.depth = (at: number[]) => (at[0] === 2 && at[1] === 4 ? 0.9 : 0.5);
  near(f.resolve(), [2, 4, 6, weight - tent(2)]);
  f.samples.depth = 0.5;
  // Another lobe or receiver is never borrowed: the pixel's own sample alone.
  f.samples.normalRough = (at: number[]) =>
    at[0] === 4 && at[1] === 4 ? [0, 0, 1, 0.5] : [0, 0, 1, 0.6];
  near(f.resolve(), [2, 4, 6, 1]);
  f.samples.normalRough = [0, 0, 1, 0.5];
  f.view.params[3] = 1;
  // Phase 1 moves every owner off (4, 4): the neighbours' pixels are still on its receiver.
  assert.equal(f.resolve()[0], 2);
});

test('a moved receiver keeps its history through the placement motion, its weight held while moving', () => {
  const f = fixture();
  f.samples.normalRough = [1, 0, 0, 0.5];
  f.samples.previousNormal = [0, 1, 0, 0.5];
  assert.deepEqual(f.resolve(), [2, 4, 6, 1], 'a turned normal without its motion is stale');
  // A quarter turn about z brings this image's normal to the last one's: the history survives.
  f.motion[0] = new Mat([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  f.view.params[2] = 1;
  assert.deepEqual(f.resolve(), [8, 16, 24, 4]);
  f.samples.historyColor = [10, 20, 30, REFLECTION_HISTORY_WEIGHT];
  f.view.params[1] = REFLECTION_MOVING_WEIGHT;
  const moving = f.resolve();
  assert.equal(moving[3], REFLECTION_MOVING_WEIGHT + 1, 'the kept weight is the moving cap');
});

test('a changed source keeps its history at the change weight, never restarts from one sample', () => {
  const f = fixture();
  f.samples.historyColor = [10, 20, 30, REFLECTION_HISTORY_WEIGHT];
  f.view.params[1] = REFLECTION_CHANGE_WEIGHT;
  const share = 1 / (REFLECTION_CHANGE_WEIGHT + 1);
  assert.deepEqual(f.resolve(), [
    10 + (2 - 10) * share,
    20 + (4 - 20) * share,
    30 + (6 - 30) * share,
    REFLECTION_CHANGE_WEIGHT + 1,
  ]);
});
