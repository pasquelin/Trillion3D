import test from 'node:test';
import assert from 'node:assert/strict';
import { eventCount, pairOrder, pile, PILE_BUDGET, settled } from './contactPile.fixture.ts';
import { startModule, startThreaded } from './module.fixture.ts';

test("a pool's contact records, replayed after the step, give the single thread's events", async () => {
  const alone = pile(await startModule(PILE_BUDGET), 240);
  const { jolt, close } = await startThreaded(4, PILE_BUDGET);
  try {
    const pooled = pile(jolt, 240);
    const sent = eventCount(alone);
    assert.ok(sent > 200, `the pile sends enters and leaves: ${sent}`);
    // Enters and leaves in the order the callbacks ran: a pool runs them in another order.
    assert.deepEqual(settled(pooled), settled(alone));
    assert.deepEqual(pairOrder(pooled), pairOrder(alone));
  } finally {
    await close();
  }
});

test('a step split over fewer threads than the pool has computes the same step', async () => {
  const alone = pile(await startModule(PILE_BUDGET), 240);
  const { jolt, close } = await startThreaded(4, PILE_BUDGET);
  try {
    assert.equal(jolt.concurrency(9), 4, 'bounded by the pool');
    assert.equal(jolt.concurrency(0), 1);
    // A bound that changes at every step, as the tuner changes it between measures.
    const bounded = pile(jolt, 240, (step) => [4, 1, 3, 2][step % 4]);
    assert.deepEqual(settled(bounded), settled(alone));
  } finally {
    await close();
  }
});
