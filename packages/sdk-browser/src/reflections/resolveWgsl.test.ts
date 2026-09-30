import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun, Mat } from '../texture/shaderRun.fixture.ts';
import {
  REFLECTION_CHANGE_WEIGHT,
  REFLECTION_HISTORY_WEIGHT,
  REFLECTION_RESOLVE_WGSL,
} from './resolveWgsl.ts';

function fixture() {
  const samples: Record<string, number | number[]> = {
    ids: [7, 0, 0, 0],
    sampleColor: [2, 4, 6, 1],
    depth: 0.5,
    normalRough: [0, 0, 1, 0.5],
    previousIds: [7, 0, 0, 0],
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
  const uv = [0.5, 0.5, 1];
  const { resolveRoughReflection } = shaderRun<{
    resolveRoughReflection: (pixel: number[]) => number[];
  }>(REFLECTION_RESOLVE_WGSL, ['resolveRoughReflection'], {
    ...Object.fromEntries(Object.keys(samples).map((key) => [key, key])),
    view,
    previousUv: () => uv,
    dpdx: () => 0,
    dpdy: () => 0,
    textureLoad: (name: string) => samples[name],
  });
  return { samples, view, uv, resolve: () => resolveRoughReflection([4, 4, 0, 1]) };
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
