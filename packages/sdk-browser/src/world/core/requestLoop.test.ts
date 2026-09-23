import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestLoop } from './requestLoop.ts';

// #336: a world whose first frames hold only lights opens no session — the pass returns without
// awaiting anything — and the next request, the first mesh's, must still run a pass.
test('a pass that returns at once leaves the loop free for the next request', async () => {
  let passes = 0;
  const loop = createRequestLoop(() => {
    passes++;
  });
  loop.request();
  assert.ok(loop.running, 'the loop is in flight once asked');
  await loop.running;
  assert.equal(loop.running, null);
  loop.request();
  await loop.running;
  assert.equal(passes, 2);
});

test('requests made while a pass runs are one more pass', async () => {
  let passes = 0,
    release = () => {};
  const loop = createRequestLoop(async () => {
    passes++;
    if (passes === 1) await new Promise<void>((resolve) => (release = resolve));
  });
  loop.request();
  loop.request();
  loop.request();
  release();
  await loop.running;
  assert.equal(passes, 2);
});
