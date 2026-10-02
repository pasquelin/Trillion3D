import test from 'node:test';
import assert from 'node:assert/strict';
import { sample, difference } from './sample.ts';
import type { Track } from './clip.ts';
import { Quaternion } from '../math/quaternion.ts';
import { Vector3 } from '../math/vector3.ts';

function rotation(values: number[], time: number) {
  const track: Track = {
    name: 'joint.quaternion',
    kind: 'quaternion',
    times: new Float32Array([0, 1]),
    values: new Float32Array(values),
    interpolation: 'linear',
  };
  return sample(track, time, {
    owner: {},
    field: 'quaternion',
    key: 0,
    value: new Float64Array(4),
  });
}

const close = (actual: number, expected: number, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

test('step tracks reach each exact key including the final pose and reverse seeks', () => {
  const track: Track = {
    name: 'joint.position',
    kind: 'number',
    times: new Float32Array([0, 1, 2]),
    values: new Float32Array([0, 5, 9]),
    interpolation: 'step',
  };
  const bound = { owner: {}, field: 'position', key: 0, value: new Float64Array(1) };
  for (const [time, expected] of [
    [0.5, 0],
    [1, 5],
    [1.5, 5],
    [2, 9],
    [3, 9],
    [1, 5],
  ])
    assert.equal(sample(track, time, bound)[0], expected);
});

test('linear quaternion tracks travel a constant angular speed off the midpoint', () => {
  for (const time of [0, 0.25, 0.75, 1]) {
    const value = rotation([0, 0, 0, 1, 0, 0, 1, 0], time);
    close(2 * Math.atan2(value[2], value[3]), Math.PI * time);
    close(Math.hypot(...value), 1);
  }
});

test('linear quaternion tracks take the shortest arc and accept antipodal keys', () => {
  const value = rotation([0, 0, 0, 1, 0, 0, -Math.SQRT1_2, -Math.SQRT1_2], 0.25);
  close(2 * Math.atan2(value[2], value[3]), Math.PI / 8);
  for (const time of [0.25, 0.5, 0.75]) {
    const antipodal = rotation([0, 0, 0, 1, 0, 0, 0, -1], time);
    close(antipodal[3], 1);
    close(Math.hypot(...antipodal), 1);
  }
});

test('linear quaternion tracks keep nearly parallel keys finite and normalized', () => {
  const angle = 1e-7;
  const value = rotation([0, 0, 0, 1, 0, 0, Math.sin(angle / 2), Math.cos(angle / 2)], 0.25);
  close(2 * Math.atan2(value[2], value[3]), angle / 4, 1e-14);
  close(Math.hypot(...value), 1);
});

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

test('a later segment interpolates its own keys, on every interpolation', () => {
  const at = (track: Track, t: number, size: number) =>
    Array.from(sample(track, t, { owner: {}, field: 'f', key: 0, value: new Float64Array(size) }));
  // Cubic, flat tangents: halfway between the second and third values, whatever the first.
  const cubic: Track = {
    name: 'p',
    kind: 'number',
    interpolation: 'cubic',
    times: new Float32Array([0, 1, 2]),
    values: new Float32Array([0, 7, 0, 0, 2, 0, 0, 4, 0]),
  };
  assert.deepEqual(at(cubic, 1.5, 1), [3]);
  // A quarter turn about z, then back: halfway through the second segment, an eighth of a turn.
  const s = Math.SQRT1_2;
  const turn: Track = {
    name: 'q',
    kind: 'quaternion',
    times: new Float32Array([0, 1, 2]),
    values: new Float32Array([0, 0, 0, 1, 0, 0, s, s, 0, 0, 0, 1]),
  };
  at(turn, 1.5, 4).forEach((v, i) =>
    close(v, [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)][i]),
  );
  // Four morph weights are numbers, never normalised like a rotation.
  const weights: Track = {
    name: 'w',
    kind: 'number',
    times: new Float32Array([0, 1]),
    values: new Float32Array([1, 2, 3, 4, 3, 4, 5, 6]),
  };
  assert.deepEqual(at(weights, 0.5, 4), [2, 3, 4, 5]);
});
