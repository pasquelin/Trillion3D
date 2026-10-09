// What a held-level read fetched and failed waits its turn by the one failure policy
// (`streaming/failures.ts`): a tile of it is not asked again before its wait ends, however many
// frames want it; one another request would meet again is never asked again. A block level's
// records fail apart: one good tile never clears another's wait.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { EngineError } from '../../../sdk-core/src/index.ts'
import { heldLevelsOf } from './heldLevels.ts'
import type { TextureLevelAddress, TextureLevelReader, TextureLevelRequest } from './levelReader.ts'
import { createPageCache } from '../streaming/pageCache.ts'
import { tileRecord } from './tileRecords.ts'

const level: TextureLevelAddress = { sha256: 'e'.repeat(64), atlas: 0, level: 0, format: 'bc7' }
/** A server's refusal with HTTP `status`. */
const refusal = (status: number) =>
  new EngineError('RESOURCE_HTTP_ERROR', `level: HTTP ${status}`, { url: 'level', status })

/** Held levels over a server answering each record `answer` gives it — refusing with HTTP
 *  `status` by default —, the clock and its timers in the test's hands: when each read was sent,
 *  and the failures reported. */
function serving(
  t: TestContext,
  status: number,
  answer = (_: TextureLevelRequest): Uint8Array => {
    throw refusal(status)
  },
) {
  const clock = { now: 0 }
  t.mock.method(performance, 'now', () => clock.now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent: number[] = [],
    failed: unknown[] = []
  const read = async (request: TextureLevelRequest) => {
    sent.push(clock.now)
    return answer(request)
  }
  const reader = Object.assign(read, { store: createPageCache(), key: 'k1' }) as TextureLevelReader
  const levels = heldLevelsOf(reader)
  /** A frame every 100 ms for `ms`, each asking the tiles `tiles`, their reads settled. */
  const frames = async (ms: number, tiles: [number, number][] = [[0, 0]]) => {
    for (const end = clock.now + ms; clock.now < end;) {
      for (const [tx, ty] of tiles)
        levels.read(level, clock.now, [256, 256], (_, error) => failed.push(error), tx, ty)
      await levels.settled()
      clock.now += 100
      t.mock.timers.tick(100)
    }
  }
  return { sent, failed, frames }
}

test('a failed level is not re-asked before its wait', async (t) => {
  const { sent, failed, frames } = serving(t, 503)
  await frames(2_000)
  assert.deepEqual(sent, [0, 500, 1500], 'once a wait, 0.5 s then 1 s: never once a frame')
  assert.equal(failed.length, 3, 'each failure reported')
})

test('a level another request would refuse again (404) is never asked again', async (t) => {
  const { sent, failed, frames } = serving(t, 404)
  await frames(10_000)
  assert.deepEqual([sent, failed.length], [[0], 1])
})

test("one tile's record landing leaves another failing record's wait running", async (t) => {
  const good = tileRecord(256, 256, 1, 0)
  const { sent, frames } = serving(t, 503, (request) => {
    if (request.range?.offset !== good.offset) throw refusal(503)
    return new Uint8Array(good.bytes)
  })
  await frames(1_000, [
    [0, 0],
    [1, 0],
  ])
  assert.deepEqual(sent, [0, 0, 500], 'the failing record waits its own turn, the good one lands')
})
