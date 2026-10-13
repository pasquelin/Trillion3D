// The victim rule of a pool of fixed slots (`eviction.ts`), against a reference written from the
// rule's statement alone: the arrival takes the slot of the order's FIRST entry that may give it —
// listed below the order's end (its old head for a lower tier), still resident, not arrived since
// the order's cut, not pinned, accepted by the arrival —; none before any order, none while the
// order is closed. Every case on generated sequences — pins, refusals, departures, arrivals, lower
// tiers, orders followed again, closed —, then the ties written out one by one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEviction, type Accept, type EvictionOrder } from './eviction.ts'
import { orderOf } from './order.fixture.ts'
import type { ResidentPage } from './types.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

/** A pool of resident pages, each committed at its own generation, and the rule over it. */
function pool() {
  const resident = new Map<string, ResidentPage>(),
    eviction = createEviction(resident)
  let generation = 0
  const arrive = (key: string) =>
    resident.set(key, { key, slot: 0, offset: 0, bytes: 4, generation: ++generation })
  return { resident, eviction, arrive, generation: () => generation }
}

/** The reference: the first entry of `order` below its end that may give its place, or none. */
function expectedVictim(
  order: EvictionOrder | undefined,
  resident: ReadonlyMap<string, ResidentPage>,
  pinned: ReadonlySet<string>,
  accept: Accept,
  lower: boolean,
) {
  if (!order?.open()) return 'eviction-queue-spent'
  const end = lower ? order.old : order.count
  for (let rank = 0; rank < end; rank++) {
    const page = resident.get(order.keyAt(rank))
    if (page && page.generation <= order.arrivals && !pinned.has(page.key) && accept(page))
      return page
  }
  return 'eviction-queue-spent'
}

test('generated sequences: the victim is the first entry of the order that may give its place', () => {
  const next = lcgRandom(0xe71c7)
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]
  const cases = { victims: 0, spent: 0, pinned: 0, refused: 0, arrivedSince: 0, gone: 0, lower: 0 }
  for (let run = 0; run < 200; run++) {
    const { resident, eviction, arrive, generation } = pool()
    const keys = Array.from({ length: 4 + Math.floor(next() * 12) }, (_, k) => `k${k}`)
    for (const key of keys) if (next() < 0.8) arrive(key)
    const pinned = new Set<string>()
    let order: EvictionOrder | undefined,
      open = true
    for (let step = 0; step < 60; step++) {
      const move = next()
      if (move < 0.12) {
        // A new order: some keys, absent ones among them, in any order, a head of old keys, made
        // before or after some arrivals.
        const listed = keys.filter(() => next() < 0.7).sort(() => next() - 0.5)
        const made = generation() - Math.floor(next() * 3)
        order = orderOf(listed, made, Math.floor(next() * (listed.length + 1)), () => open)
        eviction.follow(order)
      } else if (move < 0.17) {
        open = !open
      } else if (move < 0.27) {
        const key = pick(keys)
        if (resident.has(key) && eviction.pin(key)) pinned.add(key)
      } else if (move < 0.35) {
        const key = pick(keys)
        if (eviction.unpin(key)) pinned.delete(key)
      } else if (move < 0.42) {
        // A page arrives, or comes back: after any order made so far.
        const key = pick(keys)
        if (!resident.has(key)) arrive(key)
      } else if (move < 0.48) {
        // A page leaves another way (an unload): it is no victim any more.
        const key = pick(keys)
        if (resident.delete(key)) {
          eviction.left(key)
          pinned.delete(key)
        }
      } else {
        // An arrival asks: a quarter of the pages refused at random, a lower tier now and then.
        const refused = new Set(keys.filter(() => next() < 0.25)),
          lower = next() < 0.3,
          accept: Accept = (page) => !refused.has(page.key)
        const want = expectedVictim(order, resident, pinned, accept, lower)
        // A page the arrival refuses where every other test would have taken it: the refused case.
        if (expectedVictim(order, resident, pinned, () => true, lower) !== want) cases.refused++
        const got = eviction.victim(accept, lower)
        assert.equal(
          typeof got === 'string' ? got : got.key,
          typeof want === 'string' ? want : want.key,
          `run ${run}, step ${step}`,
        )
        if (typeof got === 'string') {
          cases.spent++
          continue
        }
        cases.victims++
        if (lower) cases.lower++
        // The caller evicts the victim: its slot goes to the arrival.
        resident.delete(got.key)
        eviction.left(got.key)
      }
      // Each kind of entry the rule passes over occurs in the runs.
      if (order)
        for (let rank = 0; rank < order.count; rank++) {
          const page = resident.get(order.keyAt(rank))
          if (!page) cases.gone++
          else if (page.generation > order.arrivals) cases.arrivedSince++
          else if (pinned.has(page.key)) cases.pinned++
        }
    }
  }
  for (const [name, count] of Object.entries(cases)) assert.ok(count > 0, `no ${name} case`)
})

test('generated sequences: a page may leave with a victim exactly when the rule could take it', () => {
  const next = lcgRandom(0x5011d)
  for (let run = 0; run < 100; run++) {
    const { resident, eviction, arrive, generation } = pool()
    const keys = Array.from({ length: 10 }, (_, k) => `k${k}`)
    for (const key of keys) if (next() < 0.8) arrive(key)
    const listed = keys.filter(() => next() < 0.7)
    const order = orderOf(listed, generation() - 1, Math.floor(next() * listed.length))
    eviction.follow(order)
    for (const key of keys) if (next() < 0.2 && resident.has(key)) eviction.pin(key)
    for (const lower of [false, true])
      for (const key of keys) {
        const rank = listed.indexOf(key),
          page = resident.get(key)
        const may =
          rank >= 0 &&
          rank < (lower ? order.old : order.count) &&
          !!page &&
          page.generation <= order.arrivals &&
          !eviction.isPinned(key)
        assert.equal(eviction.evictable(key, lower), may, `run ${run}, ${key}, lower ${lower}`)
      }
  }
})

test('ties: the first listed of entries equally eligible, held ones before those after them', () => {
  const { resident, eviction, arrive } = pool()
  for (const key of ['a', 'b', 'c', 'd']) arrive(key)
  // Four keys the GPU ranked alike (one age step, one level): the order lists them in its own
  // order, and the arrivals take them in that order, never by key or by arrival.
  eviction.follow(orderOf(['c', 'a', 'd', 'b']))
  assert.equal((eviction.victim() as ResidentPage).key, 'c')
  resident.delete('c')
  // `a` pinned and `d` refused when passed: both held, `b` taken.
  eviction.pin('a')
  assert.equal((eviction.victim((page) => page.key !== 'd') as ResidentPage).key, 'b')
  resident.delete('b')
  // Both held and both eligible again: the lower rank first, `a` before `d`.
  eviction.unpin('a')
  assert.equal((eviction.victim() as ResidentPage).key, 'a')
  resident.delete('a')
  assert.equal((eviction.victim() as ResidentPage).key, 'd')
  resident.delete('d')
  assert.equal(eviction.victim(), 'eviction-queue-spent')
})

test('ties: a held entry comes before an unpassed one, a lower tier stops at the old head', () => {
  const { resident, eviction, arrive } = pool()
  for (const key of ['a', 'b', 'c']) arrive(key)
  eviction.follow(orderOf(['a', 'b', 'c'], Number.MAX_SAFE_INTEGER, 2))
  eviction.pin('a')
  // The lower tier passes `a` (pinned: held) and takes `b`, the last of the old head.
  assert.equal((eviction.victim(undefined, true) as ResidentPage).key, 'b')
  resident.delete('b')
  // Nothing old left for it: `c` is listed past the head.
  assert.equal(eviction.victim(undefined, true), 'eviction-queue-spent')
  eviction.unpin('a')
  // `a`, held at rank 0, and `c`, never passed at rank 2: `a` first.
  assert.equal((eviction.victim() as ResidentPage).key, 'a')
  resident.delete('a')
  assert.equal((eviction.victim() as ResidentPage).key, 'c')
})

test('no victim before any order, while the order is closed, nor from a page arrived since it', () => {
  const { resident, eviction, arrive, generation } = pool()
  for (const key of ['a', 'b']) arrive(key)
  assert.equal(eviction.victim(), 'eviction-queue-spent', 'before any order')
  let open = false
  eviction.follow(orderOf(['a', 'b'], generation(), 2, () => open))
  assert.equal(eviction.victim(), 'eviction-queue-spent', 'closed')
  open = true
  // `a` leaves and comes back after the order's cut: the order names the page that left.
  resident.delete('a')
  arrive('a')
  assert.equal((eviction.victim() as ResidentPage).key, 'b')
  resident.delete('b')
  assert.equal(eviction.victim(), 'eviction-queue-spent')
  eviction.follow(undefined)
  assert.equal(eviction.victim(), 'eviction-queue-spent', 'withdrawn')
})
