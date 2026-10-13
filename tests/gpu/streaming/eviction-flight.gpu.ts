// A camera flies down a world larger than its pool, on Dawn, the engine's GPU cut, page pool and
// eviction order driving it (`evictionFlightPage.ts`); the pages land between frames and the cut
// is read back two frames behind. What the eviction must hold, every frame:
// - no page reused while in flight: each page a frame drew holds its own bytes in the slot that
//   frame's tables named, in the pool as that frame read it — its own copy, made after its cut;
// - no hole: the leaves an unbounded pool covers at that pose are covered, each once;
// - no flicker: no leaf's detail drops and comes back while the unbounded pool's does not move;
// - settled, the cut is the unbounded pool's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof } from '../kit/enginePageProof.ts'
import type { FlightFrame } from './evictionFlightPage.ts'

type Reading = Awaited<ReturnType<typeof import('./evictionFlightPage.ts').runEvictionFlight>>

/** The level each leaf unit is drawn at in `drawn`, by `copy * leaves + unit`. */
function unitLevels(
  reading: { levels: number[]; units: [number, number][]; copies: number[]; leaves: number },
  drawn: readonly number[],
) {
  const at = new Map<number, number>()
  for (const page of drawn)
    for (let u = reading.units[page][0]; u < reading.units[page][1]; u++)
      at.set(reading.copies[page] * reading.leaves + u, reading.levels[page])
  return at
}

/** Leaves whose detail drops then comes back within `span` frames while the unbounded pool's
 *  detail there does not drop. */
function dips(reading: Parameters<typeof unitLevels>[0], frames: readonly FlightFrame[], span = 6) {
  const drawn = frames.map((f) => unitLevels(reading, f.drawn)),
    truth = frames.map((f) => unitLevels(reading, f.reference))
  let count = 0
  for (let t = 1; t < frames.length; t++)
    for (const [unit, level] of drawn[t]) {
      const before = drawn[t - 1].get(unit)
      if (before === undefined || level <= before) continue
      // Coarser than the frame before: a dip unless the unbounded pool coarsened there too.
      if ((truth[t].get(unit) ?? 0) > (truth[t - 1].get(unit) ?? 0)) continue
      for (let k = t + 1; k < Math.min(frames.length, t + span); k++)
        if ((drawn[k].get(unit) ?? level) < level) {
          count++
          break
        }
    }
  return count
}

test('a flight past the pool: no slot reused under a frame, no hole, no flicker, settled whole', async () => {
  const reading = (await runPageProof(
    resolve(import.meta.dirname, 'evictionFlightPage.ts'),
    'evictionFlight',
    'runEvictionFlight',
  )) as Reading
  assertSoundProof(reading)
  assert.ok('frames' in reading && 'levels' in reading && reading.levels, String(reading))
  const { frames, evictions, pages, slots } = reading
  console.log(
    JSON.stringify({
      adapter: reading.adapter,
      pages,
      slots,
      evictions,
      landed: frames.length,
      wanted: Math.max(...frames.map((f) => f.wanted)),
      resident: Math.max(...frames.map((f) => f.resident)),
    }),
  )
  assert.ok(pages > 16 * slots, `a world of ${pages} pages through ${slots} slots`)
  assert.ok(evictions >= slots, `${evictions} pages evicted on the way: the pool turned over`)
  assert.ok(frames.length > reading.flight / 2, 'most frames read back')
  for (const f of frames) {
    assert.deepEqual(f.torn, [], `frame ${f.frame}: pages drawn from a slot that did not hold them`)
    assert.equal(f.holes, 0, `frame ${f.frame}: leaves the unbounded pool covers left uncovered`)
    assert.equal(f.overdraw, 0, `frame ${f.frame}: leaves covered twice`)
    assert.ok(f.resident <= slots && f.wanted <= slots, `frame ${f.frame}: the view fits the pool`)
  }
  assert.equal(dips(reading, frames), 0, 'no leaf loses detail and gets it back')
  const last = frames.at(-1)!
  assert.deepEqual(last.drawn, last.reference, 'settled, the cut is the unbounded pool’s')
})
