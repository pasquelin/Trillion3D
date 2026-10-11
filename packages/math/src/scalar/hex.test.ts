import test from 'node:test'
import assert from 'node:assert/strict'
import { hexOfBytes } from './hex.ts'

test('hexOfBytes writes two lowercase digits a byte, and nothing for no bytes', () => {
  assert.equal(hexOfBytes(new Uint8Array(0)), '')
  assert.equal(hexOfBytes(Uint8Array.of(0, 1, 15, 16, 171, 255)), '00010f10abff')
  const all = Uint8Array.from({ length: 256 }, (_, i) => i)
  assert.equal(
    hexOfBytes(all),
    Array.from(all, (byte) => byte.toString(16).padStart(2, '0')).join(''),
  )
})
