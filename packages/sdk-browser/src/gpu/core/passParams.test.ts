// A pass's parameters go up when one of their four words moved, and only then (the root lists',
// `../../placement/roots/rootPasses.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { passParams, writePassParams } from './passParams.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

test('a pass sends its parameters when a word moved, its fourth too, else nothing', () => {
  const gpu = fakeDevice()
  const params = passParams('params')
  const sent = () => gpu.writes.filter(({ buffer }) => buffer === params.buffer).length
  writePassParams(gpu.device, params, 3, 2, 1, 1)
  assert.equal(params.buffer?.size, 16)
  assert.equal(sent(), 1)
  writePassParams(gpu.device, params, 3, 2, 1, 1)
  assert.equal(sent(), 1, 'the same words: nothing sent')
  writePassParams(gpu.device, params, 3, 2, 1, 0)
  assert.equal(sent(), 2, 'the fourth word moved')
  assert.deepEqual([...params.words], [3, 2, 1, 0])
})
