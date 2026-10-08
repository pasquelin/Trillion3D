import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_SCENES, suiteRuns } from './suiteRuns.ts'

test('the default suite is the open-world example alone', () => {
  assert.deepEqual(suiteRuns(), ['an-open-world-of-every-cost:world'])
})

test('a suite of the cap is played, one past it is refused', () => {
  const list = (n: number) => Array.from({ length: n }, (_, k) => `page${k}`).join(',')
  assert.equal(suiteRuns(list(MAX_SCENES)).length, MAX_SCENES)
  assert.throws(() => suiteRuns(list(MAX_SCENES + 1)), /BENCH_SUITE/)
})

test('the words of the removed sets are refused, not run as page names', () => {
  for (const word of ['all', 'reference', 'priority'])
    assert.throws(() => suiteRuns(word), /BENCH_SUITE.*no longer/)
})

test('an empty list and a removed word with a scenario are refused', () => {
  assert.throws(() => suiteRuns(','), /BENCH_SUITE/)
  assert.throws(() => suiteRuns('priority:orbit,x'), /no longer/)
})
