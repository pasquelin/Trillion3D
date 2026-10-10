// The dirty rows are a changed list joined into runs by the engine's one coalescer: each row once,
// neighbours in one run, no row between two scattered runs, the rows past a limit left out.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDirtyRows } from './dirty.ts'
import { runsOf } from './dirty.fixture.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'

test('rows marked in any order, twice or by ranges, are their maximal runs, once', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const next = random(seed),
      rows = 200
    const dirty = createDirtyRows(rows)
    const model = new Set<number>()
    for (let round = 0; round < 4; round++) {
      for (let k = 0; k < 20; k++) {
        const from = Math.floor(next() * rows),
          to = Math.min(rows - 1, from + Math.floor(next() * 5))
        dirty.mark(from, to)
        for (let row = from; row <= to; row++) model.add(row)
      }
      const expected: [number, number][] = []
      for (const row of [...model].sort((a, b) => a - b)) {
        const last = expected.at(-1)
        if (last && last[1] === row - 1) last[1] = row
        else expected.push([row, row])
      }
      assert.deepEqual(runsOf(dirty.forEachRun), expected, `seed ${seed}`)
      assert.equal(dirty.count, model.size)
    }
    dirty.clear()
    assert.equal(dirty.count, 0)
    assert.deepEqual(runsOf(dirty.forEachRun), [])
  }
})

test('the rows past a limit are left out, a run cut at it', () => {
  const dirty = createDirtyRows(20)
  dirty.mark(2, 4)
  dirty.mark(9, 12)
  assert.deepEqual(
    runsOf((ctx, visit) => dirty.forEachRun(ctx, visit, 10)),
    [
      [2, 4],
      [9, 10],
    ],
  )
})

test('a grown table keeps its marks and takes the rows beyond', () => {
  const dirty = createDirtyRows(4)
  dirty.mark(3)
  dirty.grow(8)
  dirty.mark(3, 6)
  assert.deepEqual(runsOf(dirty.forEachRun), [[3, 6]])
  dirty.clear()
  dirty.mark(7)
  assert.deepEqual(runsOf(dirty.forEachRun), [[7, 7]])
})
