import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun, Mat } from '../texture/shaderRun.fixture.ts';
import { REFLECTION_RESOLVE_WGSL, REFLECTION_MOVING_WEIGHT } from './resolveWgsl.ts';

function fixture() {
  const samples: Record<string, number | number[]> = {
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
    params: [1, 64, 0, 0],
  };
  const motion = [identity];
  const uv = [0.5, 0.5, 1];
  const { resolveRoughReflection } = shaderRun<{
    resolveRoughReflection: (pixel: number[]) => number[];
  }>(
    REFLECTION_RESOLVE_WGSL,
    ['resolveRoughReflection', 'roughSamples', 'reflectionPhase', 'placementOf'],
    {
      ...Object.fromEntries(Object.keys(samples).map((key) => [key, key])),
      view,
      motion,
      pages: [{ placement: 0 }],
      previousUv: () => uv,
      dpdx: () => 0,
      dpdy: () => 0,
      // Pixel (4, 4) at phase 0 was traced by the half-resolution texel (2, 2) alone.
      textureLoad: (name: string, at: number[]) =>
        name !== 'sampleColor' || traced.some((q) => q[0] === at[0] && q[1] === at[1])
          ? samples[name]
          : [0, 0, 0, 0],
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

test('the four half-resolution texels around a pixel on its receiver and lobe are its samples', () => {
  const f = fixture();
  f.samples.historyColor = [0, 0, 0, 0];
  f.traced.push([1, 1], [2, 1], [1, 2]);
  assert.deepEqual(f.resolve(), [2, 4, 6, 4], 'each neighbour traced a pixel of the same lobe');
  f.samples.normalRough = [0, 0, 1, 0.5];
  f.view.params[3] = 1;
  // Phase 1 moves every owner off (4, 4): the neighbours' pixels are still on its receiver.
  assert.deepEqual(f.resolve(), [2, 4, 6, 4]);
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
  f.samples.historyColor = [10, 20, 30, 64];
  f.view.params[1] = REFLECTION_MOVING_WEIGHT;
  const moving = f.resolve();
  assert.equal(moving[3], REFLECTION_MOVING_WEIGHT + 1, 'the kept weight is the moving cap');
});
