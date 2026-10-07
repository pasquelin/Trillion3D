// The public `page.decode` loads the CPU decoder as a family of its own (the engine never decodes
// a page on the CPU) and answers what that decoder answers, from bytes or from their buffer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeGeometryPage } from '../../../../page-codec/src/geometryPage.ts'
import { decodeGeometryPage } from '../../page/codec/geometryPage.ts'
import { families } from '../../host/families.ts'
import { page } from './index.ts'

test('page.decode downloads the decoder on its first call and decodes as it does', async () => {
  const { data } = encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) },
  })
  const bytes = data as Uint8Array
  const expected = decodeGeometryPage(bytes)
  assert.equal(families.pageCodec.arrived, false, 'nothing loads the decoder ahead of its use')
  assert.deepEqual(await page.decode(bytes), expected)
  assert.equal(families.pageCodec.arrived, true)
  const whole = bytes.slice().buffer as ArrayBuffer
  assert.deepEqual(await page.decode(whole), expected)
})
