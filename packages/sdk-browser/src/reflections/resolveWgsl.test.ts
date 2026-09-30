import test from 'node:test';
import assert from 'node:assert/strict';
import { Mat } from '../texture/shaderRun.fixture.ts';
import { wgslConstants } from '../texture/shaderRule.fixture.ts';
import {
  REFLECTION_CHANGE_FRAMES,
  REFLECTION_CHANGE_KEPT,
  REFLECTION_HISTORY_WEIGHT,
  REFLECTION_MOVING_KEPT,
  REFLECTION_RESOLVE_WGSL,
  REFLECTION_STILL_FRAMES,
} from './resolveWgsl.ts';
import { historyConfidence } from './historyFrame.ts';
import { fixture } from './resolveWgsl.fixture.ts';

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
  const { REFLECTION_FILTER_RADIUS } = wgslConstants(REFLECTION_RESOLVE_WGSL);
  const tent = (distance: number) => 1 - distance / (REFLECTION_FILTER_RADIUS * (1 + 0.5));
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
  f.view.params[1] = REFLECTION_MOVING_KEPT;
  const moving = f.resolve();
  assert.equal(moving[3], REFLECTION_MOVING_KEPT + 1, 'the kept weight is the moving cap');
});

test('a changed source keeps its history at the change cap, never restarts from one sample', () => {
  const f = fixture();
  f.samples.historyColor = [10, 20, 30, REFLECTION_HISTORY_WEIGHT];
  f.view.params[1] = REFLECTION_CHANGE_KEPT;
  const share = 1 / (REFLECTION_CHANGE_KEPT + 1);
  assert.deepEqual(f.resolve(), [
    10 + (2 - 10) * share,
    20 + (4 - 20) * share,
    30 + (6 - 30) * share,
    REFLECTION_CHANGE_KEPT + 1,
  ]);
});

test('#1346: a source moved without motion leaves under 1/255 of its old reflection, glossy or rough', () => {
  for (const roughness of [0.06, 0.2, 0.3, 0.6]) {
    const f = fixture();
    // A flat floor: every texel around the pixel traced, on its receiver, lobe and plane.
    f.traced.length = 0;
    for (let k = 0; k < 16; k++) f.traced.push([k & 3, k >> 2]);
    f.samples.normalRough = f.samples.previousNormal = [0, 0, 1, roughness];
    let rank = 0;
    const frame = (value: number, sinceChange: number) => {
      f.samples.sampleColor = [value, value, value, 1];
      f.view.params[1] = historyConfidence(false, sinceChange, false);
      f.view.params[3] = rank++ & 3;
      f.samples.historyColor = f.resolve();
    };
    // A settled reflection of 1; then the source moves and reflects 0, through the change and the
    // still window the runtime keeps before the image may rest (`historyRuntime.ts`).
    for (let i = 0; i < 4 * REFLECTION_STILL_FRAMES; i++) frame(1, Infinity);
    for (let i = 0; i < REFLECTION_CHANGE_FRAMES + REFLECTION_STILL_FRAMES; i++) frame(0, i);
    const stale = (f.samples.historyColor as number[])[0];
    assert.ok(stale <= 1 / 255, `${stale * 255}/255 left at roughness ${roughness}`);
  }
});
