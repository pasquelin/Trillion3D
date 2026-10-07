// The reads an admission pass starts ahead share the network,
// so they come back in any order; the pass still admits the same pages in the same order. Each
// read here settles after its own random delay, and the admission of its page waits for it, as it
// joins the transfer under way.
import test from 'node:test'
import assert from 'node:assert/strict'
import { run, world } from './admissionReads.fixture.ts'

test('reads that come back out of order admit the same pages in the same order as develop', async () => {
  let reordered = 0
  for (let seed = 1; seed <= 200; seed++) {
    let draw = seed
    const random = () => (draw = (draw * 1103515245 + 12345) >>> 0) / 4294967296
    const settled: string[] = []
    const arrival = (url: string) =>
      new Promise<void>((done) =>
        setTimeout(() => (settled.push(url), done()), Math.floor(random() * 4)),
      )
    const scene = world(seed)
    const before = await run(scene, false),
      after = await run(scene, true, scene.slots, arrival)
    assert.deepEqual(after.loads, before.loads, `seed ${seed}`)
    assert.equal(String(after.error), String(before.error), `seed ${seed}`)
    const started = after.reads.map((entry) => entry.slice(5))
    if (settled.some((url, i) => url !== started[i])) reordered++
  }
  // The delays did reorder the arrivals: the order held is the admission's, not the network's.
  assert.ok(reordered > 20, `${reordered} jobs saw their reads come back out of order`)
})
