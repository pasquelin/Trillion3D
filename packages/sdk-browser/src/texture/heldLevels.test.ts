// A level file whose read failed waits its turn by the one failure policy (`streaming/failures.ts`):
// a tile of it is not asked again before its wait ends, however many frames want it; one another
// request would meet again is never asked again.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { EngineError } from '../../../sdk-core/src/index.ts'
import { createHeldLevels, readHeldLevel } from './heldLevels.ts'
import type { TextureLevelReader, TextureLevelRequest } from './levelReader.ts'

const level: TextureLevelRequest = { sha256: 'e'.repeat(64), atlas: 0, level: 0, format: 'bc7' }

/** Held levels over a server refusing every read with HTTP `status`, the clock and its timers in
 *  the test's hands: when each read was sent, and the failures reported. */
function refusing(t: TestContext, status: number) {
  const clock = { now: 0 }
  t.mock.method(performance, 'now', () => clock.now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent: number[] = [],
    failed: unknown[] = []
  const read = (async () => {
    sent.push(clock.now)
    throw new EngineError('RESOURCE_HTTP_ERROR', `level: HTTP ${status}`, { url: 'level', status })
  }) as unknown as TextureLevelReader
  const levels = createHeldLevels({ read, onFailure: (_, error) => failed.push(error) })
  t.after(() => levels.destroy())
  /** A frame every 100 ms for `ms`, each asking the level's tile, its read settled. */
  const frames = async (ms: number) => {
    for (const end = clock.now + ms; clock.now < end;) {
      readHeldLevel(levels, level, clock.now, [256, 256])
      await levels.settled()
      clock.now += 100
      t.mock.timers.tick(100)
    }
  }
  return { sent, failed, frames }
}

test('a failed level is not re-asked before its wait', async (t) => {
  const { sent, failed, frames } = refusing(t, 503)
  await frames(2_000)
  assert.deepEqual(sent, [0, 500, 1500], 'once a wait, 0.5 s then 1 s: never once a frame')
  assert.equal(failed.length, 3, 'each failure reported')
})

test('a level another request would refuse again (404) is never asked again', async (t) => {
  const { sent, failed, frames } = refusing(t, 404)
  await frames(10_000)
  assert.deepEqual([sent, failed.length], [[0], 1])
})
