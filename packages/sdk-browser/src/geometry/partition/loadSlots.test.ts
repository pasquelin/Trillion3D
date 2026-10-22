import test from 'node:test'
import assert from 'node:assert/strict'
import { loadsBefore, type LoadingCell } from './loadOrder.ts'
import { createLoadSlots } from './loadSlots.ts'
import { cellPriority, PRIORITY_VISIBLE } from '../streaming/priority.ts'
import { resolveWorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'

/** A cell wished at `distance`, as the order ranks it: one level, one grid priority. */
const at = (key: number, distance: number, always = false): LoadingCell => ({
  ...{ key, extent: 1, level: 0, priority: 0, distance, raw: distance },
  ...(always && { always }),
})
const schemes = ['hashSet', 'spatialHash'] as const

test('a cell always loaded ranks after every other, on either kind of grid, however listed', () => {
  const streaming = resolveWorldStreaming({})
  // The always loaded one, the widest, highest and nearest there is, still ranks last.
  const always = { ...at(9, 0, true), extent: 1e9, level: 9 }
  const cells = [at(3, 0.5), always, at(1, 0.1), at(2, 0.1)]
  for (const scheme of schemes) {
    const order = (list: LoadingCell[]) =>
      list.toSorted(loadsBefore(streaming, scheme)).map(({ key }) => key)
    assert.deepEqual(order(cells), [1, 2, 3, 9], scheme)
    assert.deepEqual(order(cells.toReversed()), [1, 2, 3, 9], `${scheme}, listed in reverse`)
  }
})

test('a cell always loaded starts while room is left, and takes none', () => {
  const settings = resolveWorldStreaming({ worldStreamingMaxLoadingCells: 2 })
  const slots = createLoadSlots(settings, 'hashSet')
  const [a, b, c, always] = [at(1, 0.1), at(2, 0.2), at(3, 0.3), at(9, 0, true)]
  slots.admit([c, always, b, a], false)
  // Two rooms, taken by the two nearest: the one always loaded, last in the order, finds none.
  assert.deepEqual([...slots.loading()], [1, 2])
  assert.ok(slots.queued(), 'the others wait for a slot')
  // `a` ends: one room is left, and the next in the order, `c`, takes it — never the one always
  // loaded, which ranks after it.
  slots.admit([b, c, always], false)
  assert.deepEqual([...slots.loading()], [2, 3])
  // `b` ends, `c` goes on: a room is left, and the one always loaded takes none of its own.
  slots.admit([c, always], false)
  assert.deepEqual([...slots.loading()], [3, 9])
  // It loads, so it is in flight: a cell wished from now on finds no room while two are loading.
  const d = at(4, 0.05)
  slots.admit([c, always, d], false)
  assert.deepEqual(
    [...slots.loading()],
    [3, 9],
    'the cells loading count, the one always loaded too',
  )
  // `c` ends: a room is left for `d`, nearest of all.
  slots.admit([always, d], false)
  assert.deepEqual([...slots.loading()], [9, 4])
})

test('a cell always loaded waits when no room is left, but never in the initial load', () => {
  const settings = resolveWorldStreaming({ worldStreamingMaxLoadingCells: 1 })
  const one = createLoadSlots(settings, 'spatialHash')
  one.admit([at(1, 0.1), at(2, 0.2), at(9, 0, true)], false)
  assert.deepEqual([...one.loading()], [1], 'one room, taken: the one always loaded waits')
  const initial = createLoadSlots(settings, 'spatialHash')
  initial.admit([at(9, 0, true), at(2, 0.2), at(1, 0.1)], true)
  assert.deepEqual([...initial.loading()], [1, 2, 9], 'the initial load holds none back')
  // The room is the setting less the cells loading, never more than that: with none loading, a
  // lone one always loaded starts.
  const alone = createLoadSlots(settings, 'hashSet')
  alone.admit([at(9, 0, true)], false)
  assert.deepEqual([...alone.loading()], [9])
})

test('each cell that starts takes a turn, and its reads ask by it, ahead of the pages', () => {
  const slots = createLoadSlots(resolveWorldStreaming({}), 'hashSet')
  slots.admit([at(2, 0.2), at(1, 0.1)], false)
  const [first, second] = [slots.priorityOf(1), slots.priorityOf(2)]
  assert.deepEqual([first, second], [cellPriority(0), cellPriority(1)])
  assert.ok(first < second && second < PRIORITY_VISIBLE)
  // Another starts in a later frame: its turn comes after those loading.
  slots.admit([at(2, 0.2), at(1, 0.1), at(3, 0.01)], false)
  assert.equal(slots.priorityOf(3), cellPriority(2))
  assert.equal(slots.priorityOf(1), first, 'a cell loading keeps its turn')
  // A read of no cell loading asks after them all, still within the cells' lane.
  assert.ok(slots.priorityOf() > slots.priorityOf(3) && slots.priorityOf() < PRIORITY_VISIBLE)
  assert.equal(slots.priorityOf(77), slots.priorityOf())
  // Nothing loading, the turns count from none again; so do they once the slots are let go.
  slots.admit([], false)
  slots.admit([at(5, 0.1)], false)
  assert.equal(slots.priorityOf(5), cellPriority(0))
  slots.clear()
  assert.equal(slots.priorityOf(), cellPriority(0))
})

test('0 or less cells loading at once lifts the limit; the setting is a whole 32-bit number', () => {
  assert.equal(resolveWorldStreaming({}).maxLoadingCells, 4)
  for (const limit of [0, -3]) {
    const slots = createLoadSlots(
      resolveWorldStreaming({ worldStreamingMaxLoadingCells: limit }),
      'hashSet',
    )
    slots.admit([at(3, 0.3), at(1, 0.1), at(2, 0.2)], false)
    assert.deepEqual([...slots.loading()], [1, 2, 3], `limit ${limit}: every cell starts`)
    assert.ok(!slots.queued(), `limit ${limit}: none waits for a slot`)
  }
  const refused = (value: number) => () =>
    resolveWorldStreaming({ worldStreamingMaxLoadingCells: value })
  assert.throws(refused(1.5), /worldStreamingMaxLoadingCells.*whole number/)
  assert.throws(refused(2147483648), /2147483647/)
  assert.equal(refused(-2147483648)().maxLoadingCells, -2147483648)
})
