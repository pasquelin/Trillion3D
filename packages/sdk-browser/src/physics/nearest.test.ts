import test from 'node:test'
import assert from 'node:assert/strict'
import { partition, selectNearest } from './nearest.ts'

/** `count` items of nearness drawn from `draw`, generated from a fixed seed. */
function generated(count: number, draw: (r: number) => number) {
  let seed = 7
  const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647
  return Array.from({ length: count }, () => ({ near: draw(next()) }))
}

test('a selection puts the k nearest first, whatever the order and however many ties', () => {
  const families = [
    (r: number) => r * 1000,
    (r: number) => Math.floor(r * 4),
    () => 0,
    (r: number) => (r < 0.5 ? 0 : Infinity),
  ]
  for (const draw of families)
    for (const [count, k] of [
      [1, 1],
      [10, 3],
      [500, 64],
      [500, 499],
      [2000, 1000],
    ]) {
      const list = generated(count, draw)
      const sorted = list.map(({ near }) => near).sort((a, b) => a - b)
      selectNearest(list, count, k)
      const first = list.slice(0, k).map(({ near }) => near)
      assert.equal(Math.max(...first), sorted[k - 1], `${count}, ${k}`)
      assert.deepEqual(
        first.sort((a, b) => a - b),
        sorted.slice(0, k),
        `${count}, ${k}`,
      )
    }
})

test('a partition moves what it keeps to the front, the rest after, none lost', () => {
  const list = generated(100, (r) => Math.floor(r * 10))
  const before = list.map(({ near }) => near).sort((a, b) => a - b)
  const end = partition(list, 0, list.length, ({ near }) => near < 5)
  assert.ok(list.slice(0, end).every(({ near }) => near < 5))
  assert.ok(list.slice(end).every(({ near }) => near >= 5))
  assert.deepEqual(
    list.map(({ near }) => near).sort((a, b) => a - b),
    before,
  )
})
