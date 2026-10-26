// What a held-level read fetched and failed is asked again by the one failure policy
// (`geometry/streaming/failures.ts`): at once, by the next frame that wants the tile, or after the
// wait its server asked, however many frames want it and whatever the failure of its read — bytes
// that are not its record's included; `streamingNumRetries` times (3 by default, a negative count
// without end), then the level is given up and never asked again; the first failure of a row and
// the giving up are reported. A block level's records fail apart: one good tile never clears another's
// wait.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import { heldLevelsOf } from './heldLevels.ts'
import type { TextureLevelAddress, TextureLevelReader, TextureLevelRequest } from './levelReader.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'
import { tileRecord } from './tileRecords.ts'

const level: TextureLevelAddress = { sha256: 'e'.repeat(64), atlas: 0, level: 0, format: 'bc7' }
/** A server's refusal with HTTP `status`. */
const refusal = (status: number, retryAfter?: number) =>
  new EngineError('RESOURCE_HTTP_ERROR', `level: HTTP ${status}`, {
    ...{ url: 'level', status },
    ...(retryAfter && { retryAfter }),
  })

/** Held levels over a server answering each record `answer` gives it — refusing with HTTP
 *  `status` by default —, the clock and its timers in the test's hands: when each read was sent,
 *  and the failures reported. */
function serving(
  t: TestContext,
  status: number,
  answer = (_: TextureLevelRequest): Uint8Array => {
    throw refusal(status, retryAfter)
  },
  retryAfter?: number,
  retries?: () => number,
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
  const reader = Object.assign(read, {
    store: createPageCache(),
    key: 'k1',
    retries,
  }) as TextureLevelReader
  const levels = heldLevelsOf(reader)
  /** A frame every 100 ms for `ms`, each asking the tiles `tiles`, their reads settled. */
  const frames = async (ms: number, tiles: [number, number][] = [[0, 0]]) => {
    for (const end = clock.now + ms; clock.now < end;) {
      for (const [tx, ty] of tiles)
        levels.read(level, [256, 256], (_, error) => failed.push(error), tx, ty)
      await levels.settled()
      clock.now += 100
      t.mock.timers.tick(100)
    }
  }
  return { sent, failed, frames }
}

test('a failed level is asked again by the next frame that wants it, with no wait, the first failure of a row reported', async (t) => {
  const { sent, failed, frames } = serving(t, 503)
  await frames(300)
  assert.deepEqual(sent.slice(0, 3), [0, 100, 200], 'at once, one request a frame at most')
  assert.equal(failed.length, 1, 'said once, not once a frame')
})

test('a level that keeps failing is asked again three times, then given up: no request after, said at its first failure and at its end', async (t) => {
  const { sent, failed, frames } = serving(t, 503)
  await frames(2_000)
  assert.deepEqual(sent, [0, 100, 200, 300], 'the request and its three retries')
  assert.equal(failed.length, 2)
})

test('a missing file (404) is asked again like any failed read, then given up', async (t) => {
  const { sent, failed, frames } = serving(t, 404)
  await frames(2_000)
  assert.equal(sent.length, 4)
  assert.equal(failed.length, 2)
})

test('a negative streamingNumRetries asks a failing level without end', async (t) => {
  const endless = serving(t, 503, undefined, undefined, () => -1)
  await endless.frames(2_000)
  assert.equal(endless.sent.length, 20)
  assert.equal(endless.failed.length, 1)
})

test('a zero streamingNumRetries gives a level up at its first failure', async (t) => {
  const none = serving(t, 503, undefined, undefined, () => 0)
  await none.frames(2_000)
  assert.equal(none.sent.length, 1)
  assert.equal(none.failed.length, 1)
})

test('a level whose bytes are not those its record implies is a failed read like any other: asked again three times, then given up', async (t) => {
  const { sent, failed, frames } = serving(t, 200, () => new Uint8Array(1))
  await frames(2_000)
  assert.deepEqual([sent.length, failed.length], [4, 2])
})

test('a level whose server asks a wait (Retry-After) is not asked before it', async (t) => {
  const { sent, frames } = serving(t, 503, undefined, 1_000)
  await frames(2_000)
  assert.deepEqual(sent, [0, 1000], 'asked again once the server said')
})

test("one tile's record landing leaves another failing record's wait running", async (t) => {
  const good = tileRecord(256, 256, 1, 0)
  const { sent, frames } = serving(t, 503, (request) => {
    if (request.tx !== 1 || request.ty !== 0) throw refusal(503, 500)
    return new Uint8Array(good.bytes)
  })
  await frames(1_000, [
    [0, 0],
    [1, 0],
  ])
  assert.deepEqual(sent, [0, 0, 500], 'the failing record waits its own turn, the good one lands')
})
