// A cut's dispatch past one dimension's workgroups runs in rows instead of being refused (#974):
// the host's flat dispatches and the kernel's indirect arguments take the same rows, and the
// kernels' flat index reaches every thread of them once. The kernel's functions run in Node.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './shader.ts'
import { DEFAULT_GROUP_WIDTH, dispatchGrid } from './gridWgsl.ts'
import { wgslScope } from '../../../page/cut/wgslPredicate.fixture.ts'

const grid = (width: number) => {
  const scope = wgslScope(DAG_SELECTION_SHADER, { GROUP_WIDTH: width, min: Math.min })
  const fn = (name: string) => scope.fn(name) as (...args: number[]) => number
  return { x: fn('gridX'), y: fn('gridY'), flat: fn('flatIndex') }
}

test('a list opened slice by slice arms the rows the host would dispatch', () => {
  const k = grid(3)
  for (let groups = 1; groups <= 20; groups++) {
    // The appends raise x and y to the largest slice's: the argument the last slice leaves.
    let x = 0,
      y = 0
    for (let slice = 0; slice < groups; slice++) {
      x = Math.max(x, k.x(slice))
      y = Math.max(y, k.y(slice))
    }
    assert.deepEqual([x, y], dispatchGrid(groups, 3), `${groups} groups`)
    assert.ok(x <= 3 && x * y >= groups, 'within the width, every group')
  }
  const wide = grid(DEFAULT_GROUP_WIDTH)
  for (const groups of [1, 65_535, 65_536, 131_071])
    assert.deepEqual([wide.x(groups - 1), wide.y(groups - 1)], dispatchGrid(groups))
  assert.deepEqual(dispatchGrid(65_535), [65_535, 1], 'one row: the dispatch of before')
  assert.deepEqual(dispatchGrid(65_536), [65_535, 2])
})

test('the flat index reaches every thread of the rows once, in order', () => {
  const k = grid(3)
  for (const groups of [1, 3, 4, 10]) {
    const [x, y] = dispatchGrid(groups, 3),
      seen: number[] = []
    for (let row = 0; row < y; row++)
      for (let thread = 0; thread < x * 64; thread++) seen.push(k.flat(thread, row, x))
    assert.deepEqual(
      seen,
      seen.map((_, i) => i),
      `${groups} groups`,
    )
  }
})
