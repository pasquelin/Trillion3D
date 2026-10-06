import test from 'node:test'
import assert from 'node:assert/strict'
import { eventCount, pile, PILE_BUDGET, reversedStep } from './contactPile.fixture.ts'
import { startModule, startThreaded } from './module.fixture.ts'

/** An event row `type,a,b,…`'s pair key: the lower engine index first, as `contacts.cpp` sorts
 *  them. */
function pairKey(row: string): [number, number] {
  const [, a, b] = row.split(',').map(Number)
  return a < b ? [a, b] : [b, a]
}

/** Pair keys ascending: the lower engine index, then the higher. */
const byPairKey = (x: [number, number], y: [number, number]) => x[0] - y[0] || x[1] - y[1]

test("a pool's contact records, replayed after the step, give the single thread's events in its order", async () => {
  const alone = pile(await startModule(PILE_BUDGET), 240)
  const { jolt, close } = await startThreaded(4, PILE_BUDGET)
  try {
    const pooled = pile(jolt, 240)
    const sent = eventCount(alone)
    assert.ok(sent > 200, `the pile sends enters and leaves: ${sent}`)
    // Every step's events in the single thread's order, whatever order the callbacks ran in.
    assert.deepEqual(pooled, alone)
    assert.notDeepEqual(reversedStep(pooled), alone, "one step's events reversed is told apart")
  } finally {
    await close()
  }
})

test('a step split over fewer threads than the pool has computes the same step', async () => {
  const alone = pile(await startModule(PILE_BUDGET), 240)
  const { jolt, close } = await startThreaded(4, PILE_BUDGET)
  try {
    assert.equal(jolt.concurrency(9), 4, 'bounded by the pool')
    assert.equal(jolt.concurrency(0), 1)
    // A bound that changes at every step, as the tuner changes it between measures.
    const bounded = pile(jolt, 240, (step) => [4, 1, 3, 2][step % 4])
    assert.deepEqual(bounded, alone)
  } finally {
    await close()
  }
})

test("a step's merged records come in the engine's canonical pair-key order, whatever the pool", async () => {
  // No cloth and no removals: every event is then a record the pool's threads left and
  // `replayContacts` merged after `Update`. A cloth's leaves and a removed body's are written
  // after and before that merge (`contacts.cpp`), so they are not what this rule or test covers.
  const scene = { cloth: false, changes: false }
  const alone = pile(await startModule(PILE_BUDGET), 240, undefined, scene)
  // One module per pile: a pile adds bodies of its own engine ids, so a second on the same one
  // is refused.
  const full = await startThreaded(4, PILE_BUDGET)
  const changing = await startThreaded(4, PILE_BUDGET)
  try {
    const pooled = pile(full.jolt, 240, undefined, scene)
    const bounded = pile(changing.jolt, 240, (step) => [4, 1, 3, 2][step % 4], scene)
    let sent = 0
    for (let s = 0; s < alone.length; s++) {
      const keys = alone[s].events.map(pairKey)
      sent += keys.length
      assert.deepEqual(keys, [...keys].sort(byPairKey), `step ${s}: pair keys ascend`)
      assert.deepEqual(pooled[s].events, alone[s].events, `step ${s}: the full pool`)
      assert.deepEqual(bounded[s].events, alone[s].events, `step ${s}: a bound that changes`)
    }
    assert.ok(sent > 200, `the pile sends enters and leaves: ${sent}`)
  } finally {
    await Promise.all([full.close(), changing.close()])
  }
})
