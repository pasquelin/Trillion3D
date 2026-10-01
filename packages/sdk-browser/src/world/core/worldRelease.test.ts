import test from 'node:test';
import assert from 'node:assert/strict';
import { worldReleases, finishWorldRelease } from './worldRelease.ts';

test('world device teardown waits for an old reopening session and a late new session release', async () => {
  const releases = worldReleases();
  let oldDone!: () => void, openDone!: () => void, lateDone!: () => void;
  const old = new Promise<void>((done) => (oldDone = done));
  const opened = new Promise<void>((done) => (openDone = done));
  const late = new Promise<void>((done) => (lateDone = done));
  const events: string[] = [];
  void releases.close({ dispose: () => old });
  const reopening = opened.then(() => releases.close({ dispose: () => late }));
  const drained = releases.drain(null, reopening);
  finishWorldRelease(drained, { dispose: () => events.push('device') }, () =>
    events.push('canvas'),
  );
  oldDone();
  await Promise.resolve();
  assert.deepEqual(events, []);
  openDone();
  await Promise.resolve();
  assert.deepEqual(events, []);
  lateDone();
  await drained;
  await Promise.resolve();
  assert.deepEqual(events, ['device', 'canvas']);
});
