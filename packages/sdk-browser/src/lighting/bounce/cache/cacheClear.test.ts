import assert from 'node:assert/strict'
import test from 'node:test'
import { clearCacheMaps, copyRowBytes } from './cacheClear.ts'

test('a row of a clear copy is a whole number of 256 bytes', () => {
  assert.equal(copyRowBytes(1, 'r32float'), 256)
  assert.equal(copyRowBytes(64, 'r32float'), 256)
  assert.equal(copyRowBytes(65, 'r32float'), 512)
  assert.equal(copyRowBytes(100, 'rgba16float'), 1024)
})

Object.assign(globalThis, { GPUBufferUsage: { COPY_SRC: 4 } })

test('every level of the final maps, and the sky only where it is kept, is set to black', () => {
  const copies: { level: number | undefined; size: number[] }[] = []
  const texture = (width: number, height: number, mipLevelCount: number) =>
    ({ width, height, mipLevelCount, format: 'r32float' }) as unknown as GPUTexture
  const encoder = {
    copyBufferToTexture: (_: unknown, to: { mipLevel?: number }, size: number[]) =>
      copies.push({ level: to.mipLevel, size }),
  } as unknown as GPUCommandEncoder
  const device = {
    createBuffer: () => ({ destroy() {} }),
    queue: {},
  } as unknown as GPUDevice
  const storage = (skyVisibility: boolean) =>
    ({ final: texture(40, 20, 3), sky: texture(40, 20, 1), shape: { skyVisibility } }) as never
  clearCacheMaps(device, encoder, storage(false))
  assert.deepEqual(
    copies.map((c) => c.size),
    [
      [40, 20],
      [20, 10],
      [10, 5],
    ],
  )
  copies.length = 0
  clearCacheMaps(device, encoder, storage(true))
  assert.equal(copies.length, 4)
})
