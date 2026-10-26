import test from 'node:test'
import assert from 'node:assert/strict'
import { testRunFlags } from './unit-tests.ts'

test('a local run caps the test processes; the CI and its shards keep full parallelism', () => {
  assert.deepEqual(testRunFlags({}, 12), ['--test-concurrency=6'])
  assert.deepEqual(testRunFlags({}, 1), ['--test-concurrency=1'])
  assert.deepEqual(testRunFlags({ TRILLION3D_TEST_SHARD: '' }, 8), ['--test-concurrency=4'])
  assert.deepEqual(testRunFlags({ TRILLION3D_TEST_CONCURRENCY: '4' }), ['--test-concurrency=4'])
  assert.deepEqual(testRunFlags({ CI: 'true' }), [])
  assert.deepEqual(testRunFlags({ CI: 'true', TRILLION3D_TEST_SHARD: '2/3' }), ['--test-shard=2/3'])
})
