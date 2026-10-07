// The page management parameters: the constant `VSM_PM_PARAMS_BYTES` is the size of the WGSL struct
// `VsmPmParams` the kernels read, and the host writes no word beyond it, in any slot.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice, written } from '../../../../tests/kit/gpu/fakeDevice.ts'
import {
  encodeVsmPageCarry,
  encodeVsmAfterRaster,
  encodeVsmPageMapping,
  vsmPmContextBytes,
} from './pageManagementPass.ts'
import {
  VSM_PM_GROUP_PARAMS,
  VSM_PM_GROUP_PER_PAGE,
  VSM_PM_PARAMS_BYTES,
  vsmPhysicalPageKernels,
} from './physicalPagesWgsl.ts'
import { VSM_PER_PAGE_BIN_COUNT } from './markingPass.ts'
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
 *  (slots are `slotWords` words apart). Throws when one is not 0. */
function assertWithinWords(
  writes: { offset: number; words: number[] }[],
  words: number,
  slotWords = 64,
) {
  for (const { offset, words: data } of writes)
    data.forEach((word, k) => {
      const inSlot = ((offset >> 2) + k) % slotWords
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

/** The three encoders run on a device aligning uniform offsets at `alignment`, the cache valid and
 *  not, stats and not, over per-page bins: its records, and each group set with its dynamic offset. */
function encodeAll(alignment = 256) {
  const fake = fakeDevice({
    limits: {
      maxStorageBuffersPerShaderStage: 10,
      maxStorageBufferBindingSize: 1 << 27,
      minUniformBufferOffsetAlignment: alignment,
    },
  })
  const bound: { group: number; offset?: number }[] = []
  const pass = new Proxy(
    {},
    {
      get: (_, name) =>
        name === 'setBindGroup'
          ? (group: number, _set: unknown, offsets?: readonly number[]) =>
              void bound.push({ group, offset: offsets?.[0] })
          : () => undefined,
    },
  )
  const encoder = {
    beginComputePass: () => pass,
    copyBufferToBuffer: () => undefined,
  } as unknown as GPUCommandEncoder
  const res = createVsmResources(fake.device, { ...options, poolPages: 256 })
  const perPageBins = [3, 2, 1, 4].map((count, b) => ({ offset: 2 * b, count }))
  const writes: { offset: number; words: number[] }[] = []
  for (const valid of [false, true])
    for (const stats of [false, true]) {
      res.prevFrameKept = valid
      const frame = {
        device: fake.device,
        mapCount: 5,
        fullMapCount: 3,
        nextMapCount: 7,
        perPageBins,
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
        writes.push({ offset: w.offset, words: Array.from(new Uint32Array(copy.buffer)) })
      }
    }
  return { fake, bound, writes }
}

/** The parameter buffer's writes over the three encoders, the cache valid and not. */
const parameterWrites = () => encodeAll().writes

test('the writes to the parameter slots stay within the struct’s 2 words', () => {
  const writes = parameterWrites()
  assert.ok(writes.length >= 8, 'every slot is written, cache valid and not')
  assert.ok(
    writes.some(({ words }) => words.some((w) => w !== 0)),
    'the words are the ones read, not an empty buffer',
  )
  assertWithinWords(writes, VSM_PM_PARAMS_BYTES / 4)
})

test('a device aligning at 512 lays the parameter and per-page slots 512 bytes apart', () => {
  const { fake, bound, writes } = encodeAll(512)
  const size = (label: string) => fake.buffers.find((b) => b.label === label)!.size
  assert.equal(size('vsm.pm.params'), 2 * 512)
  assert.equal(size('vsm.pm.perPage'), VSM_PER_PAGE_BIN_COUNT * 512)
  // What the ledger counts for the context is what it made.
  const made = ['vsm.pm.params', 'vsm.pm.perPage', 'vsm.pm.argsInit'].map(size)
  assert.equal(vsmPmContextBytes(fake.device.limits), made[0] + made[1] + made[2])
  const sorted = (values: Iterable<number | undefined>) =>
    [...new Set(values)].sort((a, b) => a! - b!)
  // The two parameter slots, each written at its own 512-byte step.
  assert.deepEqual(sorted(writes.map((w) => w.offset)), [0, 512])
  assertWithinWords(writes, VSM_PM_PARAMS_BYTES / 4, 128)
  const at = (group: number) => sorted(bound.filter((b) => b.group === group).map((b) => b.offset))
  assert.deepEqual(at(VSM_PM_GROUP_PARAMS), [0, 512])
  assert.deepEqual(at(VSM_PM_GROUP_PER_PAGE), [0, 512, 1024, 1536])
})

test('the guard fails when a word beyond the struct is written', () => {
  const writes = parameterWrites()
  // A write one slot's 2 words long, spilled 2 words past them.
  const spilled = writes.map(({ offset, words }) => ({ offset, words: [...words, 0, 1] }))
  assert.throws(() => assertWithinWords(spilled, 2), /word 3 of a slot holds 1/)
})
