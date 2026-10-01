import test from 'node:test';
import assert from 'node:assert/strict';
import { createRippleModel } from './model.ts';
import type { Splat } from './types.ts';

test('fixed ripple ticks retain sub-frame time and bound a stalled frame', () => {
  for (const rate of [15, 30] as const) {
    const model = createRippleModel({ resolution: 512, rate });
    let steps = 0;
    for (let i = 0; i < 60; i++) steps += model.plan(1 / 60).steps;
    assert.equal(steps, rate);
    assert.equal(model.plan(10).steps, 4);
    assert.equal(model.plan(10).droppedSteps, rate * 10 - 4);
    assert.equal(model.plan(0).steps, 0);
  }
});

test('splats are staged without a simulation tick, limited per frame and local at 10km', () => {
  const model = createRippleModel({ resolution: 256, rate: 30 });
  const splat: Splat = [10000.125, -9999.75, 1, 0.01];
  const work = model.plan(0, { camera: [10000, -10000], splats: Array(65).fill(splat) });
  assert.deepEqual([work.steps, work.splats, work.dropped], [0, 64, 1]);
  assert.deepEqual([...model.records.slice(0, 4)], [0.125, 0.25, 1, Math.fround(0.01)]);
  assert.equal(model.plan(1 / 30).splats, 0, 'no reinjection at the next solve');
  assert.equal(model.plan(0, { camera: [10000, -10000], splats: [splat] }).splats, 1);
});

test('camera shifts describe overlap in integer texels, including negative positions', () => {
  const model = createRippleModel({ resolution: 256, rate: 30 });
  model.plan(0, { camera: [10, 20], splats: [] });
  assert.equal(model.plan(0, { camera: [10.1, 20.2], splats: [] }).recentered, false);
  const work = model.plan(0, { camera: [10.25, 19.75], splats: [] });
  assert.deepEqual([work.shiftX, work.shiftZ], [1, -1]);
  // Output cell12 reads old cell13: both represent the same world x after a +dx move.
  assert.equal(10.25 + 12 * model.dx, 10 + 13 * model.dx);
  assert.equal(model.plan(0, { camera: [-1000, 0], splats: [] }).recentered, true);
});

test('unstable CFL and nonfinite inputs are refused before GPU encoding', () => {
  assert.throws(() => createRippleModel({ resolution: 512, rate: 15, depth: 10 }), /CFL/);
  assert.throws(() => createRippleModel({ resolution: 256, rate: 30, damping: NaN }), RangeError);
  const model = createRippleModel({ resolution: 256, rate: 30 });
  assert.throws(() => model.plan(Infinity), RangeError);
  assert.throws(() => model.plan(0, { camera: [NaN, 0], splats: [] }), RangeError);
  assert.throws(() => model.plan(0, { camera: [0, 0], splats: [[0, 0, 0, 0.1]] }), RangeError);
  const outside = model.plan(0, { camera: [0, 0], splats: [[100, 100, 1, 0.01]] });
  assert.deepEqual([outside.splats, outside.dropped], [0, 1]);
});

test('steady ripple planning reuses its work record and staging storage', () => {
  const model = createRippleModel({ resolution: 256, rate: 30 });
  const first = model.plan(0),
    records = model.records;
  for (let i = 0; i < 60; i++) {
    assert.equal(model.plan(1 / 60), first);
    assert.equal(model.records, records);
  }
});
