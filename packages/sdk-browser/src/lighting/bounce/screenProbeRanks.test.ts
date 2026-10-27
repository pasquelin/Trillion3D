// The uniforms of the spatial filter's passes (`passRanks`): one for each pass, counted by the view's allocator, destroyed together.
import test from 'node:test'
import assert from 'node:assert/strict'
import { passRanks } from './screen/groupParts.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'

installGpuGlobals()

/** A device that keeps the buffers it made, and the words written to them. */
function fakeDevice() {
  const made: { size: number; destroyed: boolean; words?: number[]; destroy(): void }[] = []
  const device = {
    createBuffer({ size }: { size: number }) {
      const buffer = {
        size,
        destroyed: false,
        words: undefined as number[] | undefined,
        destroy() {
          buffer.destroyed = true
        },
      }
      made.push(buffer)
      return buffer
    },
    queue: {
      writeBuffer(buffer: { words?: number[] }, _: number, data: Uint32Array) {
        buffer.words = Array.from(data)
      },
    },
  } as unknown as GPUDevice
  return { device, made }
}

test('a pass of the spatial filter has a uniform of its own that holds its rank', () => {
  const { device, made } = fakeDevice()
  const { buffers } = passRanks(device, 3)
  assert.equal(buffers.length, 3)
  assert.deepEqual(
    made.map((buffer) => [buffer.size, buffer.words]),
    [
      [16, [0]],
      [16, [1]],
      [16, [2]],
    ],
  )
  assert.equal(passRanks(device, 0).buffers.length, 0, 'no pass, no uniform')
})

test('the uniforms are all destroyed by one call, so that a rebuild of the groups leaves none behind', () => {
  const { device, made } = fakeDevice()
  const ranks = passRanks(device, 5)
  assert.ok(made.every((buffer) => !buffer.destroyed))
  ranks.destroy()
  assert.equal(made.length, 5)
  assert.ok(made.every((buffer) => buffer.destroyed))
})
