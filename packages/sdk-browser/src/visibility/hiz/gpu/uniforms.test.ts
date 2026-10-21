import test from 'node:test'
import assert from 'node:assert/strict'
import { HIZ_SLOT_WORDS, hizUniformSlots } from './uniforms.ts'
import { createGpuHiz } from './factory.ts'
import { pyramidLayout } from './pyramid.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { written } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'

const SLOT_WORDS = HIZ_SLOT_WORDS
/** Words between two slots on a 256-byte device. */
const STRIDE_WORDS = 64

test('the uniforms go up as the words that changed: the build words, at creation', async () => {
  const { device, writes } = fakeDevice()
  const hiz = (await createGpuHiz(device, 64, 32))!
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
  const after = uniform().length
  hiz.extent(64, 32)
  assert.equal(uniform().length, after, 'the same size sends nothing')
  hiz.dispose()
})

test('a device aligning at 512 lays the build slots 512 bytes apart, the padding unsent', async () => {
  const { device, writes, buffers } = fakeDevice({
    limits: { minUniformBufferOffsetAlignment: 512 },
  })
  const hiz = (await createGpuHiz(device, 64, 32))!
  const uniforms = buffers.find((b) => b.label === 'Trillion3D HiZ uniforms')!
  // The deepest pyramid's four build passes.
  assert.equal(uniforms.size, 4 * 512)
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
      [...at256.words.subarray(i * STRIDE_WORDS, i * STRIDE_WORDS + SLOT_WORDS)],
    )
  // Each build pass binds its slot at its own 512-byte step.
  const bound: number[] = []
  const pass = {
    setPipeline() {},
    setBindGroup: (_: number, __: unknown, offsets?: readonly number[]) =>
      void (offsets && bound.push(offsets[0])),
    dispatchWorkgroups() {},
  } as unknown as GPUComputePassEncoder
  hiz.encodePyramid({ pass })
  assert.deepEqual(
    bound,
    slots.map(([offset]) => offset),
  )
  hiz.dispose()
})
