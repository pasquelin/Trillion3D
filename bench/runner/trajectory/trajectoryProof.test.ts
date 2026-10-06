import assert from 'node:assert/strict';
import test from 'node:test';
import type { Capture } from '../../../tests/kit/server/staticServer.ts';
import {
  checkpointIndices,
  trajectoryVerdict,
  type TrajectoryCheckpoint,
} from './trajectoryProof.ts';
import { FRAMES_PER_SEGMENT, PATH_POSES } from './poses.ts';

function fixture() {
  const image = (red: number): Capture => ({ body: Buffer.from([red, 10, 20, 255]), w: 1, h: 1 });
  const captures = new Map(
    ['golden', 'repeat', 'arrival', 'settled'].map((name) => [name, image(40)]),
  );
  const checkpoint = (settled: string): TrajectoryCheckpoint => ({
    index: 60,
    arrival: 'arrival',
    settled,
    settleFrames: 2,
    pagesRequested: 1,
    residentPages: 2,
  });
  const reference = checkpoint('golden'),
    repeat = checkpoint('repeat'),
    candidate = checkpoint('settled');
  const verdict = () => trajectoryVerdict(reference, repeat, candidate, captures);
  return { image, captures, reference, repeat, candidate, verdict };
}

test('a settled exact image passes; a changed arrival that converges is transient', () => {
  const f = fixture();
  assert.equal(f.verdict().status, 'match');
  f.captures.set('arrival', f.image(41));
  const verdict = f.verdict();
  assert.equal(verdict.status, 'transient');
  assert.deepEqual(verdict.arrival, {
    pixels: 1,
    maxChannel: 1,
    meanChannel: 1 / 3,
    p999Channel: 1,
    total: 1,
  });
  assert.deepEqual(verdict.settled, {
    pixels: 0,
    maxChannel: 0,
    meanChannel: 0,
    p999Channel: 0,
    total: 1,
  });
});

test('one changed channel after convergence is a regression, even when arrival matched', () => {
  const f = fixture();
  f.captures.set('settled', f.image(41));
  assert.equal(f.verdict().status, 'regression');
});

test('streaming timeout never becomes a match or a claimed regression', () => {
  const f = fixture();
  f.candidate.settleFrames = null;
  assert.equal(f.verdict().status, 'unsettled');
  f.captures.set('settled', f.image(41));
  assert.equal(f.verdict().status, 'unsettled');
});

test('an unstable or unconverged reference cannot certify a candidate', () => {
  const f = fixture();
  f.captures.set('repeat', f.image(41));
  assert.equal(f.verdict().status, 'unstable-reference');
  f.captures.set('repeat', f.image(40));
  f.reference.settleFrames = null;
  assert.equal(f.verdict().status, 'unstable-reference');
});

test('missing, black, malformed-size, or mismatched-checkpoint evidence is invalid', () => {
  for (const capture of [
    null,
    { body: Buffer.from([0, 0, 0, 255]), w: 1, h: 1 },
    { body: Buffer.alloc(8, 50), w: 2, h: 1 },
  ]) {
    const f = fixture();
    f.captures.set('settled', capture);
    assert.equal(f.verdict().status, 'invalid');
  }
  const f = fixture();
  f.candidate.index++;
  assert.equal(f.verdict().status, 'invalid');
});

test('the default route captures every segment and the last frame; invalid bounds fail', () => {
  const indices = checkpointIndices(PATH_POSES, FRAMES_PER_SEGMENT);
  assert.deepEqual(indices, [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 599]);
  assert.deepEqual(checkpointIndices(1, 60), [0]);
  for (const [frames, interval] of [
    [0, 60],
    [1.5, 60],
    [601, 60],
    [60, 0],
    [60, 61],
    [600, 18],
  ])
    assert.throws(() => checkpointIndices(frames, interval));
});
