// Proof in the browser (PHY-19, #934): in a cross-origin isolated page, the threaded physics module
// (`joltPhysicsThreads.wasm`), its pool's threads in workers, gives the single-thread module's
// poses and contact events at every step of a pile of boxes, compounds and a cloth — each step's
// events the same, and every pair's enters and leaves in the same order. The contact callbacks run
// on Jolt's threads; each keeps its record in its own thread's list and the step replays them
// after `Update` (`contacts.cpp`). Nothing is timed.
//
//   node tests/browser/renders/physics-threaded-contacts.browser.ts
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { withRepoPage } from '../../kit/server/repoPage.ts';
import {
  eventCount,
  pairOrder,
  settled,
} from '../../../packages/sdk-browser/src/physics/contactPile.fixture.ts';
import type { ThreadedContacts } from '../support/threadedContactsWorker.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const THREADS = 4;

const result = await withRepoPage(
  ROOT,
  true,
  (page) =>
    page.evaluate(
      ({ url, threads }) =>
        new Promise<ThreadedContacts>((done) => {
          const worker = new Worker(url, { type: 'module' });
          worker.onmessage = ({ data }) => done(data);
          worker.onerror = (event) => done({ error: event.message || 'the worker did not load' });
          // A pool whose threads never run would block its step for good: named, not waited on.
          setTimeout(() => done({ error: 'the piles did not end in 120 s' }), 120_000);
          worker.postMessage({ type: 'proof', threads, steps: 240 });
        }),
      { url: '/tests/browser/support/threadedContactsWorker.ts', threads: THREADS },
    ),
  { isolation: true },
);
if ('error' in result) assert.fail(result.error);
const { isolated, threads, alone, pooled } = result;
assert.ok(isolated, 'the page is cross-origin isolated: its memory can be shared');
assert.equal(threads, THREADS, 'the threaded module runs its pool');
assert.ok(eventCount(alone) > 200, `the pile sends enters and leaves: ${eventCount(alone)}`);
assert.deepEqual(settled(pooled), settled(alone));
assert.deepEqual(pairOrder(pooled), pairOrder(alone));
const inOrder = pooled.filter((step, s) => step.events.join() === alone[s].events.join()).length;
console.log(
  `${eventCount(pooled)} events over ${pooled.length} steps on ${threads} threads: the single ` +
    `thread's at every step, every pair in its order; ${inOrder} steps in the single thread's order`,
);
