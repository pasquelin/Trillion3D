import assert from 'node:assert/strict';
import test from 'node:test';
import { makeCameraPath } from './paths.ts';
import type { CameraPose } from '../contracts/index.ts';

const home: CameraPose = {
  position: [13, 24, 30],
  target: [10, 20, 30],
  fov: 55,
  near: 0.1,
  far: 100,
};
const close = (actual: number[], expected: number[]) =>
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12));

test('fast orbit visits cardinal directions around the target and returns home', () => {
  const path = makeCameraPath('fast-orbit', home, 5);
  const expected = [
    [13, 24, 30],
    [10, 24, 33],
    [7, 24, 30],
    [10, 24, 27],
    [13, 24, 30],
  ];
  path.forEach((pose, i) => {
    close(pose.position, expected[i]);
    assert.deepEqual(pose.target, home.target);
    assert.notEqual(pose.target, home.target);
    assert.equal(pose.fov, 55);
  });
  assert.deepEqual(home.position, [13, 24, 30]);
});

test('slow orbit makes an eighth turn and round trip retraces its outbound poses', () => {
  const slow = makeCameraPath('slow-orbit', home, 3);
  close(slow[2].position, [12.121320343559642, 24, 32.121320343559645]);
  const path = makeCameraPath('round-trip', home, 5);
  close(path[0].position, home.position);
  close(path[2].position, slow[2].position);
  close(path[1].position, path[3].position);
  close(path[4].position, home.position);
});

test('near-far scales every offset from a translated target while preserving its direction', () => {
  const path = makeCameraPath('near-far', home, 3);
  close(path[0].position, [10.9, 21.2, 30]);
  close(path[1].position, home.position);
  close(path[2].position, [15.1, 26.8, 30]);
  const zHome: CameraPose = { ...home, position: [10, 24, 33] };
  close(makeCameraPath('near-far', zHome, 2)[1].position, [10, 26.8, 35.1]);
});

test('sample limits are inclusive and invalid sizes are refused', () => {
  assert.equal(makeCameraPath('stationary', home, 2).length, 2);
  assert.equal(makeCameraPath('stationary', home, 6000).length, 6000);
  assert.equal(makeCameraPath('stationary', home).length, 60);
  for (const count of [0, 1, 6001, 2.5, NaN, Infinity])
    assert.throws(() => makeCameraPath('stationary', home, count), /samples must be 2\.\.6000/);
});

test('off-axis orbit turns both horizontal offsets with the same orientation', () => {
  const diagonal: CameraPose = { ...home, position: [13, 24, 32] };
  const path = makeCameraPath('fast-orbit', diagonal, 5);
  const expected = [
    [13, 24, 32],
    [8, 24, 33],
    [7, 24, 28],
    [12, 24, 27],
    [13, 24, 32],
  ];
  path.forEach((pose, i) => close(pose.position, expected[i]));
  close(
    makeCameraPath('slow-orbit', diagonal, 2)[1].position,
    [10.707106781186548, 24, 33.53553390593274],
  );
});
