import test from 'node:test'
import assert from 'node:assert/strict'
import { debugPixelsSize } from './state.ts'

test('the debug texture is two texels a pixel each way, none where that passes the device’s edge', () => {
  assert.deepEqual(debugPixelsSize(1920, 1080, 8192), [3840, 2160])
  assert.deepEqual(debugPixelsSize(4096, 100, 8192), [8192, 200])
  assert.equal(debugPixelsSize(4097, 100, 8192), undefined)
  assert.equal(debugPixelsSize(100, 4097, 8192), undefined)
  assert.deepEqual(debugPixelsSize(0, 0, 8192), [1, 1])
})
