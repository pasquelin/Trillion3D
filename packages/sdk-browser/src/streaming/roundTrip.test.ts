import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoundTrip } from './roundTrip.ts'
import { createPageStreamer } from './pageStreamer.ts'
import { servedPages } from './servedPages.fixture.ts'

test('the round trip takes its first measure, then an eighth of each lateness', () => {
  const trip = createRoundTrip()
  assert.equal(trip.ms(), 0, 'nothing measured yet')
  for (const none of [NaN, -1, -Infinity, Infinity]) trip.note(none)
  assert.equal(trip.ms(), 0, 'what is not a duration is not a measure')
  trip.note(40)
  assert.equal(trip.ms(), 40, 'the first measure is taken as it is')
  trip.note(80)
  assert.equal(trip.ms(), 45, 'the second moves it by an eighth of its lateness')
  trip.note(Infinity)
  assert.equal(trip.ms(), 45)
  const local = createRoundTrip()
  local.note(-0)
  local.note(80)
  assert.equal(local.ms(), 10, 'a zero is a measure')
})

test('a streamer measures its reads until the bytes land, and a cached page adds nothing', async (t) => {
  const { pages } = await servedPages(['a.bin', 'b.bin'])
  // A clock the network moves: 30 ms until the answer, 12 more until its body is read.
  let clock = 0
  t.mock.method(performance, 'now', () => clock)
  const served = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    clock += 30
    const response = await served(url, init)
    const body = await response.arrayBuffer()
    return Object.assign(response, {
      arrayBuffer: async () => ((clock += 12), body),
    })
  })
  const streamer = createPageStreamer(pages, 'http://cache/', { workerCount: 1 })
  t.after(() => streamer.dispose())
  assert.equal(streamer.roundTripMs(), 0)
  await streamer.readBytes('a.bin', streamer.signal)
  assert.equal(streamer.roundTripMs(), 42)
  await streamer.readBytes('a.bin', streamer.signal)
  assert.equal(streamer.roundTripMs(), 42, 'a page held is not read again')
  await streamer.readBytes('b.bin', streamer.signal)
  assert.equal(streamer.roundTripMs(), 42, 'the same trip again leaves it where it is')
})
