// A pass's parameters go up when one of their words moved, and only then: the rows pass's five
// words (`../../placement/rowWordsPass.ts`) as the root lists' three.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PASS_PARAM_BYTES, passParams, writePassParams } from './passParams.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

test('a pass sends its parameters when a word moved, its fifth too, else nothing', () => {
  const gpu = fakeDevice()
  const params = passParams('params')
  const sent = () => gpu.writes.filter(({ buffer }) => buffer === params.buffer).length
  writePassParams(gpu.device, params, 3, 2, 1, 0, 1)
  assert.equal(params.buffer?.size, PASS_PARAM_BYTES)
  assert.equal(sent(), 1)
  writePassParams(gpu.device, params, 3, 2, 1, 0, 1)
  assert.equal(sent(), 1, 'the same words: nothing sent')
  writePassParams(gpu.device, params, 3, 2, 1, 0, 0)
  assert.equal(sent(), 2, 'the fifth word moved')
  assert.deepEqual([...params.words.subarray(0, 5)], [3, 2, 1, 0, 0])
})
