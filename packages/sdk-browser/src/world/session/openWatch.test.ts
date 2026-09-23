import test from 'node:test';
import assert from 'node:assert/strict';
import { watchFirstFrame, watchOpening } from './openWatch.ts';

const wait = () => new Promise((wake) => setTimeout(wake, 20));

test('an opening that never settles is named on the console with the step it waits in', async (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const stuck = watchOpening('models/avenue/manifest.json', 5);
  stuck.note('backend-preparation-start', 'Backend preparation started');
  watchOpening('models/avenue/manifest.json', 5).done();
  await wait();
  assert.equal(warned.mock.callCount(), 1);
  assert.match(
    String(warned.mock.calls[0].arguments[0]),
    /avenue\/manifest\.json.*not opened.*backend-preparation-start/,
  );
});

test('a world that has drawn nothing says where it stands; one with nothing to say is quiet', async (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  watchFirstFrame(() => 'no session has opened', 5);
  watchFirstFrame(() => null, 5);
  await wait();
  assert.equal(warned.mock.callCount(), 1);
  assert.match(String(warned.mock.calls[0].arguments[0]), /no frame drawn.*no session has opened/);
});
