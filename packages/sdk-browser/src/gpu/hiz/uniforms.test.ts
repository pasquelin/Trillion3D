import test from 'node:test'
import assert from 'node:assert/strict'
import { HIZ_UNIFORM_BYTES, hizTestSlot } from './uniforms.ts'
import { createGpuHiz } from './hiz.ts'
import { pyramidLayout } from './pyramid.ts'
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts'

const SLOT_WORDS = HIZ_UNIFORM_BYTES / 4

/** The slot a test encoding uploads: a zeroed float array, integer words written through a fresh
 *  view, the fourth word the bits of a fresh `Float32Array([0])`, the sixth word 1 on a sampled
 *  frame. */
function slotBefore(width: number, height: number, rows: number, counting = 0) {
  const packed = new Float32Array(SLOT_WORDS)
  const bias = new Uint32Array(new Float32Array([0]).buffer)[0]
  new Uint32Array(packed.buffer).set([width, height, rows, bias, 0, counting])
  return [...new Uint32Array(packed.buffer)]
}

test('the Hi-Z test slot holds the words it did, over whatever the slot held', () => {
  const image = new Uint32Array(4 * SLOT_WORDS).fill(0xdeadbeef)
  for (const [width, height, rows, counting = 0] of [
    [1920, 1080, 4096],
    [7, 3, 0, 1],
    [16384, 16384, 2 ** 32 - 1],
  ]) {
    hizTestSlot(image, 2 * SLOT_WORDS, width, height, rows, !!counting)
    assert.deepEqual(
      [...image.subarray(2 * SLOT_WORDS, 3 * SLOT_WORDS)],
      slotBefore(width, height, rows, counting),
    )
  }
  assert.ok(image.subarray(0, 2 * SLOT_WORDS).every((word) => word === 0xdeadbeef))
})

test('the uniforms go up as the words that changed: build words, then the test slot', async () => {
  const { device, writes } = fakeDevice()
  const hiz = (await createGpuHiz(device, 64, 32, 8))!
  const uniform = () => writes.filter((w) => w.buffer.label === 'Trillion3D HiZ uniforms')
  /** The buffer's words, as every write so far left them over its zeros. */
  const held = () => {
    const words = new Uint32Array(uniform()[0].buffer.size / 4)
    for (const w of uniform()) words.set(new Uint32Array(written(w)), w.offset / 4)
    return words
  }
  // The pyramid's build words, at creation.
  const { words } = pyramidLayout(64, 32)
  assert.deepEqual([...held().subarray(0, words.length)], [...words])
  hiz.attach({} as GPUBuffer, {} as GPUBuffer)
  const open = {
    pass: {
      setPipeline() {},
      setBindGroup() {},
      dispatchWorkgroups() {},
    } as unknown as GPUComputePassEncoder,
  }
  const slot = () => [...held().subarray(words.length, words.length + SLOT_WORDS)]
  hiz.encodeTest(device, open, 5, {} as GPUBuffer, false)
  assert.deepEqual(slot(), slotBefore(64, 32, 5))
  const after = uniform().length
  hiz.encodeTest(device, open, 5, {} as GPUBuffer, false)
  assert.equal(uniform().length, after, 'the same frame sends nothing')
  hiz.encodeTest(device, open, 6, {} as GPUBuffer, true)
  assert.deepEqual(slot(), slotBefore(64, 32, 6, 1))
  assert.equal(uniform().length, after + 1, 'one write: the words that changed')
  hiz.dispose()
})
