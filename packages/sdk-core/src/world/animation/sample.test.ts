import test from 'node:test';
import assert from 'node:assert/strict';
import { sample } from './sample.ts';
import type { Track } from './index.ts';

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
