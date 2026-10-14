// One main-thread clock a frame: its stages — arrivals, texture tiles, the residency queue — spend
// it in their order, each admitting its first piece, and together never past the share by more
// than those first pieces.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFrameBudget } from './frameBudget.ts'

/** A stage on `clock` that spends pieces of `cost` ms while admitted; returns the pieces it ran. */
function runStage(
  clock: ReturnType<typeof createFrameBudget>,
  tick: (ms: number) => void,
  cost: number,
) {
  let pieces = 0
  while (clock.admits() && pieces < 100) {
    tick(cost)
    clock.spend()
    pieces++
  }
  clock.pause()
  return pieces
}

test('three stages on one clock spend the share once, each its first piece admitted', () => {
  let now = 0
  const tick = (ms: number) => void (now += ms)
  const clock = createFrameBudget(2, () => now)
  const frame = now
  clock.open()
  const arrivals = runStage(clock, tick, 0.5)
  tick(3) // the engine's own work: the clock stands still
  clock.stage()
  const textures = runStage(clock, tick, 0.5)
  tick(1)
  clock.stage()
  const residency = runStage(clock, tick, 0.5)
  assert.deepEqual([arrivals, textures, residency], [4, 1, 1])
  // Integration spent 2 ms, and one piece each the stages after the share: never 2 + 2 + 1.
  assert.equal(now - frame - 3 - 1, 3)
})

test('a stage reads what the stages before it left', () => {
  let now = 0
  const clock = createFrameBudget(2, () => now)
  clock.open()
  now += 0.5
  clock.spend()
  clock.pause()
  now += 10
  clock.stage()
  let pieces = 0
  while (clock.admits()) {
    now += 0.25
    clock.spend()
    pieces++
  }
  assert.equal(pieces, 6, '1.5 ms left, a quarter each')
})

test('a stopped clock stays stopped, and a running one keeps its time when resumed', () => {
  let now = 0
  const clock = createFrameBudget(1, () => now)
  clock.open()
  clock.spend()
  now += 0.6
  clock.resume()
  now += 0.6
  assert.equal(clock.admits(), false, 'resume did not restart the count')
  clock.pause()
  clock.pause()
  now += 5
  clock.stage()
  clock.spend()
  assert.equal(clock.admits(), false, 'the paused time spent none, the share is gone')
})

test("a stage's own ceiling stops it before the frame's share, and the next stage starts afresh", () => {
  let now = 0
  const clock = createFrameBudget(4, () => now)
  clock.open()
  const capped = () => {
    let pieces = 0
    while (clock.admits()) {
      now += 0.5
      clock.spend()
      pieces++
    }
    return pieces
  }
  clock.stage(1)
  assert.equal(capped(), 2, 'the ceiling of 1 ms, half a ms each')
  assert.equal(clock.stageMs(), 1)
  clock.pause()
  clock.stage()
  assert.equal(capped(), 6, 'no ceiling: the 3 ms the share has left')
  assert.equal(clock.stageMs(), 3)
})
