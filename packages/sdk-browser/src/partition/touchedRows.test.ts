// The engine is told the rows written, never the range between the first and the last: the free
// list hands rows out last in, first out, so one cell's rows can lie at both ends of the table.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTouchedRows, type RowLink } from './rows.ts'
import type { PlacementRows } from '../placement/rows.ts'

const link = () => ({ placements: {} as PlacementRows }) satisfies RowLink

function flushed(touch: (touched: ReturnType<typeof createTouchedRows>) => void) {
  const touched = createTouchedRows(),
    told: [PlacementRows, number, number][] = []
  touch(touched)
  touched.flush((rows, from, to) => void told.push([rows, from, to]))
  return told
}

test('rows written at both ends of a huge table are two runs, never the table between', () => {
  const [a, b] = [link(), link()]
  const told = flushed((touched) => {
    for (const row of [5, 1_000_000, 6, 5, 7]) touched.touch(a, row)
    touched.touch(b, 3)
  })
  assert.deepEqual(told, [
    [a.placements, 5, 7],
    [a.placements, 1_000_000, 1_000_000],
    [b.placements, 3, 3],
  ])
  const covered = told.reduce((sum, [, from, to]) => sum + to - from + 1, 0)
  assert.equal(covered, 5, 'the rows the engine reads are the distinct rows written')
})

test('a flush forgets what it told, and a cleared set tells nothing', () => {
  const touched = createTouchedRows(),
    a = link(),
    told: number[] = []
  touched.touch(a, 2)
  touched.flush((_, from) => void told.push(from))
  touched.flush((_, from) => void told.push(from))
  touched.touch(a, 9)
  touched.clear()
  touched.flush((_, from) => void told.push(from))
  assert.deepEqual(told, [2])
})
