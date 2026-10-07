import test from 'node:test'
import assert from 'node:assert/strict'
import { selectByKey } from './select.ts'

/** `count` items of nearness drawn from `draw`, generated from a fixed seed. */
function generated(count: number, draw: (r: number) => number) {
  let seed = 7
  const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647
  return Array.from({ length: count }, () => ({ near: draw(next()) }))
}

test('a selection puts the item of a rank at it, the smaller before and the larger after, ties and all', () => {
  const families = [
    (r: number) => r * 1000,
    (r: number) => Math.floor(r * 4),
    () => 0,
    (r: number) => (r < 0.5 ? 0 : Infinity),
  ]
  for (const draw of families)
    for (const [count, at] of [
      [1, 0],
      [10, 2],
      [500, 63],
      [500, 498],
      [2000, 999],
    ]) {
      const list = generated(count, draw)
      const sorted = list.map(({ near }) => near).sort((a, b) => a - b)
      selectByKey(list, (item) => item.near, 0, count, at)
      assert.equal(list[at].near, sorted[at], `${count}, ${at}`)
      assert.ok(
        list.slice(0, at).every(({ near }) => near <= sorted[at]),
        `${count}, ${at}`,
      )
      assert.ok(
        list.slice(at + 1).every(({ near }) => near >= sorted[at]),
        `${count}, ${at}`,
      )
    }
})
