// The proxy's instances in a record table of its own (`proxyInstanceTable.ts`): made at the first need
// with every instance the host holds, grown twice over when the copies outgrow it — written whole, the one
// replaced retired after the frame —, and written by the runs that moved alone. Over the device double.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProxyInstanceTable, INSTANCE_TABLE } from './proxyInstanceTable.ts'
import { recordWordAt } from '../core/recordTexture.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import type { FakeTexture } from '../../../../../tests/kit/gpu/fakeRecords.ts'

/** Instance `w`'s four words as the table `view` names holds them. */
const instance = (view: GPUTextureView | undefined, w: number) => {
  const texture = (view as unknown as { texture: FakeTexture }).texture,
    at = recordWordAt(INSTANCE_TABLE, texture, 'Instance', w)
  return Array.from(texture.words!.subarray(at, at + 4))
}

test('the instances go up whole, grow twice over, and move by the runs that moved', () => {
  installGpuGlobals()
  const gpu = fakeDevice()
  const table = createProxyInstanceTable(gpu.device)
  assert.equal(table.view, undefined, 'none before the first need')
  const words = Uint32Array.from({ length: 12 }, (_, k) => k)
  table.hold(words)
  const first = table.view
  assert.deepEqual(instance(first, 2), [8, 9, 10, 11])
  // A copy more: the table of three is replaced by one of six, every instance written again.
  const more = Uint32Array.from({ length: 16 }, (_, k) => 100 + k)
  table.hold(more)
  assert.notEqual(table.view, first, 'a new table')
  assert.deepEqual(instance(table.view, 3), [112, 113, 114, 115])
  const held = table.view
  table.hold(Uint32Array.from({ length: 24 }))
  assert.equal(table.view, held, 'six held: no growth')
  // One instance moved: its texel alone.
  const writes = gpu.textureWrites.length
  more[4] = 7
  table.write(more, 1, 1)
  assert.equal(gpu.textureWrites.length, writes + 1)
  assert.deepEqual(instance(table.view, 1), [7, 105, 106, 107])
  table.destroy()
})
