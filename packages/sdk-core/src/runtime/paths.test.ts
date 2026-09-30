import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_SCENARIOS, makeCameraPath } from './paths.ts';
import type { CameraPose } from '../contracts/index.ts';

const home: CameraPose = {
  position: [13, 24, 30],
  target: [10, 20, 30],
  fov: 55,
  near: 0.1,
  far: 100,
};
const close = (actual: number[], expected: number[]) =>
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12, `${value}`));
/** Whether `makeCameraPath` can build a path of that name. */
const builds = (id: string) => {
  try {
    makeCameraPath(id as Parameters<typeof makeCameraPath>[0], home, 2);
    return true;
  } catch {
    return false;
  }
};

test('makeCameraPath keeps a stationary camera on the home pose', () => {
  const path = makeCameraPath('stationary', home, 4);
  assert.equal(path.length, 4);
  for (const pose of path) assert.deepEqual(pose.position, home.position);
});

test('a scenario is available exactly when a camera path replays it, the initial load aside', () => {
  const ids = CAMERA_SCENARIOS.map((scenario) => scenario.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const { id, available, scope } of CAMERA_SCENARIOS) {
    // The initial load is measured while the scene loads, on no path.
    assert.equal(available, id === 'initial-load' || builds(id), id);
    assert.notEqual(id.trim(), '', 'a scenario has a name to select it by');
    assert.notEqual(scope.trim(), '', `${id} says what it measures`);
  }
  assert.ok(
    CAMERA_SCENARIOS.some((scenario) => !scenario.available),
    'the scenarios still to build are listed',
  );
  assert.equal(builds('initial-load'), false);
});

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
    assert.equal(pose.fov, home.fov);
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
  close(path[1].position, makeCameraPath('slow-orbit', home, 5)[2].position);
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

test('sample limits are inclusive and invalid sizes are refused', () => {
  assert.equal(makeCameraPath('stationary', home, 2).length, 2);
  assert.equal(makeCameraPath('stationary', home, 6000).length, 6000);
  assert.equal(makeCameraPath('stationary', home).length, 60);
  for (const count of [0, 1, 6001, 2.5, NaN, Infinity])
    assert.throws(() => makeCameraPath('stationary', home, count), /samples must be 2\.\.6000/);
});

test('an unknown path is refused instead of drawn as some other path', () => {
  for (const kind of ['pop-in', 'toString', ''])
    assert.throws(
      () => makeCameraPath(kind as Parameters<typeof makeCameraPath>[0], home),
      /unknown camera path/,
    );
});
