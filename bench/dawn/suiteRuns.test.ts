import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_SCENES, suiteRuns } from './suiteRuns.ts'

test('the default suite is the bench scene alone', () => {
  assert.deepEqual(suiteRuns(), ['bench-scene:world'])
})

test('a suite of the cap is played, one past it is refused', () => {
  const list = (n: number) => Array.from({ length: n }, (_, k) => `page${k}`).join(',')
  assert.equal(suiteRuns(list(MAX_SCENES)).length, MAX_SCENES)
  assert.throws(() => suiteRuns(list(MAX_SCENES + 1)), /BENCH_SUITE/)
})

test('no word names a bigger set', () => {
  for (const word of ['all', 'reference', 'priority']) assert.deepEqual(suiteRuns(word), [word])
})
