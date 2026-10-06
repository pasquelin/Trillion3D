// The page management parameters: the constant `VSM_PM_PARAMS_BYTES` is the size of the WGSL struct
// `VsmPmParams` the kernels read, and the host writes no word beyond it, in any slot.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice, written } from '../../../../tests/kit/gpu/fakeDevice.ts'
import {
  encodeVsmPageCarry,
  encodeVsmAfterRaster,
  encodeVsmPageMapping,
} from './pageManagementPass.ts'
import { VSM_PM_PARAMS_BYTES, vsmPhysicalPageKernels } from './physicalPagesWgsl.ts'
import { createVsmResources } from './resources.ts'
import { wgslStructLayout } from './wgslStructLayout.fixture.ts'
import { vsmLayout } from './layout.ts'

const options = { fullMapCapacity: 127, sunMapCapacity: 35 }

/** Every kernel of the physical pages declares the struct: the one text they share. */
const kernelTexts = () =>
  Object.values(vsmPhysicalPageKernels(vsmLayout(options, 2 ** 27), { stats: false })).map(
    (kernel) => kernel.code,
  )

/** Throws unless the struct of `text` is `VSM_PM_PARAMS_BYTES` long, 4 bytes a field. */
function assertParamsStruct(text: string) {
  const { size, offsets } = wgslStructLayout(text, 'VsmPmParams')
  assert.equal(size, VSM_PM_PARAMS_BYTES)
  assert.deepEqual(Object.values(offsets), [0, 4])
}

/** The words each slot's write holds beyond word `words`, from the writes to the parameter buffer
 *  (slots are 256 bytes apart). Throws when one is not 0. */
function assertWithinWords(writes: { offset: number; words: number[] }[], words: number) {
  for (const { offset, words: data } of writes)
    data.forEach((word, k) => {
      const inSlot = ((offset >> 2) + k) % 64
      if (inSlot >= words) assert.equal(word, 0, `word ${inSlot} of a slot holds ${word}`)
    })
}

test('VSM_PM_PARAMS_BYTES is the size of the struct the kernels read: 8', () => {
  assert.equal(VSM_PM_PARAMS_BYTES, 8)
  const texts = kernelTexts()
  assert.ok(texts.length > 0)
  for (const text of texts) assertParamsStruct(text)
})

test('the guard fails when a field is added to the struct, or its size drifts', () => {
  const [text] = kernelTexts()
  assert.throws(() =>
    assertParamsStruct(text.replace('struct VsmPmParams{', 'struct VsmPmParams{\n extra:u32,')),
  )
  assert.throws(() => assertParamsStruct(text.replace('hasPrevFrame:u32,', 'hasPrevFrame:vec2u,')))
})

/** The parameter buffer's writes over the three encoders, the cache valid and not. */
function parameterWrites() {
  const fake = fakeDevice({
    limits: { maxStorageBuffersPerShaderStage: 10, maxStorageBufferBindingSize: 1 << 27 },
  })
  const pass = new Proxy({}, { get: () => () => undefined })
  const encoder = {
    beginComputePass: () => pass,
    copyBufferToBuffer: () => undefined,
  } as unknown as GPUCommandEncoder
  const res = createVsmResources(fake.device, { ...options, poolPages: 256 })
  const found: { offset: number; words: number[] }[] = []
  for (const valid of [false, true])
    for (const stats of [false, true]) {
      res.prevFrameKept = valid
      const frame = {
        device: fake.device,
        mapCount: 5,
        fullMapCount: 3,
        nextMapCount: 7,
        options: { stats },
      }
      encodeVsmPageCarry(pass as GPUComputePassEncoder, res, frame)
      encodeVsmPageMapping(encoder, res, frame)
      encodeVsmAfterRaster(encoder, res, frame)
      for (const w of fake.writes.splice(0)) {
        if ((w.buffer as unknown as { label: string }).label !== 'vsm.pm.params') continue
        const d = written(w)
        const bytes = new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
        const copy = bytes.slice(0, bytes.length & ~3)
        found.push({ offset: w.offset, words: Array.from(new Uint32Array(copy.buffer)) })
      }
    }
  return found
}

test('the writes to the parameter slots stay within the struct’s 2 words', () => {
  const writes = parameterWrites()
  assert.ok(writes.length >= 8, 'every slot is written, cache valid and not')
  assert.ok(
    writes.some(({ words }) => words.some((w) => w !== 0)),
    'the words are the ones read, not an empty buffer',
  )
  assertWithinWords(writes, VSM_PM_PARAMS_BYTES / 4)
})

test('the guard fails when a word beyond the struct is written', () => {
  const writes = parameterWrites()
  const spilled = writes.map(({ offset, words }) => ({
    offset,
    words: words.map((w, k) => (k % 64 === 3 ? 1 : w)),
  }))
  assert.throws(() => assertWithinWords(spilled, 2), /word 3 of a slot holds 1/)
})
