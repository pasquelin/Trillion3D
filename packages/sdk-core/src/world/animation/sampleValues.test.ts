import test from 'node:test';
import assert from 'node:assert/strict';
import { sample, difference } from './sample.ts';
import type { Track } from './index.ts';
import { Quaternion } from '../math/quaternion.ts';
import { Vector3 } from '../math/vector3.ts';

test('linear vector tracks clamp outside keys and resume correctly after backwards seeks', () => {
  const track: Track = {
    name: 'position',
    kind: 'vector',
    times: new Float32Array([2, 4, 8]),
    values: new Float32Array([1, 2, 3, 5, 10, 15, 9, 14, 19]),
  };
  const bound = { owner: {}, field: 'position', key: 0, value: new Float64Array(3) };
  for (const [time, expected, key] of [
    [-3, [1, 2, 3], 0],
    [3, [3, 6, 9], 0],
    [6, [7, 12, 17], 1],
    [10, [9, 14, 19], 2],
    [5, [6, 11, 16], 1],
    [2, [1, 2, 3], 0],
  ] as const) {
    assert.deepEqual([...sample(track, time, bound)], expected);
    assert.equal(bound.key, key);
  }
});

test('cubic spline tangents reproduce a quadratic trajectory with non-unit key spacing', () => {
  // Position (t², 2t²+1) at t=2,4; its derivative is (2t,4t).
  const track: Track = {
    name: 'position',
    kind: 'vector',
    interpolation: 'cubic',
    times: new Float32Array([2, 4]),
    values: new Float32Array([4, 8, 4, 9, 4, 8, 8, 16, 16, 33, 8, 16]),
  };
  const bound = { owner: {}, field: 'position', key: 0, value: new Float64Array(2) };
  for (const time of [2, 2.5, 3, 3.5, 4, 2.25])
    assert.deepEqual([...sample(track, time, bound)], [time ** 2, 2 * time ** 2 + 1]);
  assert.deepEqual([...sample(track, 0, bound)], [4, 9]);
  assert.deepEqual([...sample(track, 9, bound)], [16, 33]);
  const rotation: Track = {
    ...track,
    kind: 'quaternion',
    values: new Float32Array([
      0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0,
    ]),
  };
  const q = sample(rotation, 3, { ...bound, value: new Float64Array(4) });
  assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-9);
  assert.ok(Math.abs(q[2] - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(q[3] - Math.SQRT1_2) < 1e-9);
});

test('additive vector and quaternion differences reconstruct the original keyed pose', () => {
  const track: Track = {
    name: 'position',
    kind: 'vector',
    times: new Float32Array(),
    values: new Float32Array(),
  };
  const value = new Float64Array([5, -3, 12]);
  assert.equal(difference(track, value, new Float64Array([2, -7, 4])), value);
  assert.deepEqual([...value], [3, 4, 8]);
  const reference = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.8);
  const target = new Quaternion().setFromAxisAngle(new Vector3(-2, 1, 4).normalize(), 1.3);
  const delta = difference(
    { ...track, kind: 'quaternion' },
    new Float64Array(target.elements),
    new Float64Array(reference.elements),
  );
  const rebuilt = reference.clone().multiply(new Quaternion().fromArray(delta));
  assert.ok(rebuilt.angleTo(target) < 1e-7);
});
