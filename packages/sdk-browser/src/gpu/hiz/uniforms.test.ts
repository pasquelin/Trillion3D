import test from 'node:test'
import assert from 'node:assert/strict'
import { HIZ_UNIFORM_BINDING_BYTES, hizTestSlot, hizUniformSlots } from './uniforms.ts'
import { createGpuHiz } from './hiz.ts'
import { pyramidLayout } from './pyramid.ts'
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts'

const SLOT_WORDS = HIZ_UNIFORM_BINDING_BYTES / 4

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
  const { words } = pyramidLayout(64, 32, hizUniformSlots())
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

test('a device aligning at 512 lays the build and test slots 512 bytes apart, the padding unsent', async () => {
  const { device, writes, buffers } = fakeDevice({
    limits: { minUniformBufferOffsetAlignment: 512 },
  })
  const hiz = (await createGpuHiz(device, 64, 32, 8))!
  const uniforms = buffers.find((b) => b.label === 'Trillion3D HiZ uniforms')!
  // The deepest pyramid's four build passes, then the test's slot.
  assert.equal(uniforms.size, 5 * 512)
  const sent = () => writes.filter((w) => w.buffer.label === uniforms.label)
  const held = new Uint32Array(uniforms.size / 4)
  /** Every write so far over the buffer's zeros; throws if one reaches a slot's padding. */
  const replay = () => {
    for (const w of sent()) {
      const at = w.offset / 4,
        data = new Uint32Array(written(w))
      held.set(data, at)
      assert.ok((at % 128) + data.length <= SLOT_WORDS, `a write reaches the padding at word ${at}`)
    }
    return held
  }
  // Each build slot holds what the slot of a 256-byte device held, at its 512-byte step.
  const at256 = pyramidLayout(64, 32, hizUniformSlots())
  const { passes, slots } = pyramidLayout(64, 32, hizUniformSlots(device.limits))
  assert.deepEqual(
    slots,
    at256.slots.map(([offset]) => [offset * 2]),
  )
  replay()
  for (let i = 0; i < passes.length; i++)
    assert.deepEqual(
      [...held.subarray(i * 128, i * 128 + SLOT_WORDS)],
      [...at256.words.subarray(i * SLOT_WORDS, (i + 1) * SLOT_WORDS)],
    )
  // The test slot follows the build's, bound at its own 512-byte step.
  hiz.attach({} as GPUBuffer, {} as GPUBuffer)
  const bound: number[] = []
  const pass = {
    setPipeline() {},
    setBindGroup: (_: number, __: unknown, offsets?: readonly number[]) =>
      void (offsets && bound.push(offsets[0])),
    dispatchWorkgroups() {},
  } as unknown as GPUComputePassEncoder
  hiz.encodePyramid({ pass })
  hiz.encodeTest(device, { pass }, 5, {} as GPUBuffer, true)
  const test = passes.length * 512
  assert.deepEqual(bound, [...slots.map(([offset]) => offset), test])
  replay()
  assert.deepEqual([...held.subarray(test / 4, test / 4 + SLOT_WORDS)], slotBefore(64, 32, 5, 1))
  hiz.dispose()
})
