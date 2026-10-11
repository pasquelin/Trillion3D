// A cut that starts with nothing resident reaches the pool's state through the resident pages alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRowPageState } from './pageState.ts'

test('the resident pages are the flags up, never the catalogue', () => {
  const state = createRowPageState(
    () => undefined,
    () => 1_000_000,
  )
  state.setResidentFlag(7, 1)
  state.setResidentFlag(900_000, 1)
  state.setResidentFlag(12, 1)
  state.setResidentFlag(12, 0)
  const { pages, count } = state.residentPages()
  assert.deepEqual(
    [...pages.subarray(0, count)].sort((a, b) => a - b),
    [7, 900_000],
  )
  assert.equal(pages.length, 2)
})
