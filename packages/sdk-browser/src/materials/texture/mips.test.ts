// A chain's levels reduce on the device without waiting for it: held uniforms grown twice their
// size at least, one pipeline a format, sRGB levels read decoded, one labelled pass, views and groups
// made once.
import test from 'node:test'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import assert from 'node:assert/strict'
import { generateMaterialMips } from './mipBatch.ts'
import { mipLevelCountFor } from './tiles.ts'
import { TEXTURE_MIPS_PASS } from './mipsPass.ts'
import { REDUCE, oneChain, scratch, wider } from './mips.fixture.ts'
import { writtenBytes } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'

test('reduction submits without waiting for the device and keeps its buffers', () => {
  const { device, texture, buffers, submits } = scratch()
  const before = buffers.length
  oneChain(device, texture, 'rgba8unorm')
  oneChain(device, texture, 'rgba8unorm')
  assert.equal(submits.length, 2, 'both chains went out')
  assert.equal(buffers.length - before, 1, 'one uniform buffer for both, never destroyed')
})

// A batch outgrowing the held uniforms grows them to twice their size at least (`sizedBuffer.ts`),
// the outgrown buffer retired: destroyed after the frame's submit (`frameRetire.ts`), as the work
// it encoded may read it.
test('uniforms take a block a level, at the alignment, grown twice their size at least', async () => {
  const { device, texture, buffers, writes, destroyed } = scratch()
  oneChain(device, texture, 'rgba8unorm')
  const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment ?? 256)
  assert.equal(writtenBytes(writes[0]).byteLength, mipLevelCountFor(4, 4) * stride)
  const sixteen = wider(device, texture, 16)
  generateMaterialMips(device, [{ texture: sixteen, format: 'rgba8unorm', width: 16, height: 16 }])
  const uniforms = buffers.filter(({ label }) => label === 'Trillion3D texture mips uniforms')
  assert.deepEqual(
    uniforms.map(({ size }) => size),
    [768, 1536],
    '3 blocks of 256 bytes, then twice them for 5',
  )
  assert.equal(destroyed.includes(uniforms[0]), false, 'kept while the queue may read it')
  destroyRetired(device)
  assert.deepEqual(
    uniforms.map((buffer) => destroyed.includes(buffer)),
    [true, false],
  )
})

// A colour chain encodes its levels again (`srgb`): one reduction pipeline per format, built with
// its constant. The compiler proves the rule's bytes (`texture/tests/alpha_mean.rs`).
test('one reduction pipeline per format, the sRGB one built with its constant', () => {
  const { device, texture, computePipelines } = scratch()
  for (let n = 0; n < 3; n++) oneChain(device, texture, 'rgba8unorm-srgb')
  oneChain(device, texture, 'rgba8unorm')
  const reductions = computePipelines.filter(({ compute }) => compute.entryPoint === REDUCE)
  assert.deepEqual(
    reductions.map(({ compute }) => compute.constants),
    [{ srgb: 1 }, { srgb: 0 }],
  )
})

// A colour level is read decoded through its sRGB view — sampled alone (4), WebGPU refusing an sRGB
// view with storage usage — and written through the texture's own `rgba8unorm` storage view.
test('a level reads the one above in the pool format and writes its own storage view', () => {
  const { device, texture } = scratch()
  const groups: GPUBindGroupEntry[][] = [],
    createBindGroup = device.createBindGroup.bind(device)
  device.createBindGroup = (desc) => (groups.push([...desc.entries]), createBindGroup(desc))
  oneChain(device, texture, 'rgba8unorm-srgb')
  const view = (entries: GPUBindGroupEntry[], binding: number) =>
    entries.find((entry) => entry.binding === binding)!.resource as GPUTextureViewDescriptor
  assert.equal(groups.length, 2, 'one group a level')
  for (const entries of groups) {
    assert.deepEqual([view(entries, 0).format, view(entries, 0).usage], ['rgba8unorm-srgb', 4])
    assert.equal(view(entries, 2).format, 'rgba8unorm')
  }
})

// #685: the pass carries its label, so no pass the engine begins is unnamed; nothing is drawn.
test('a chain’s reductions run in one labelled compute pass', () => {
  const { device, texture, passes, commands } = scratch()
  oneChain(device, texture, 'rgba8unorm-srgb')
  assert.deepEqual(commands, [`compute ${TEXTURE_MIPS_PASS}`])
  assert.deepEqual(passes, [])
})

// A live texture reduces at every new picture, alone: its views and groups are made once, a chain
// with no sRGB view reading and writing through the same views.
test('a texture reduced again at the same place makes no view nor group again', () => {
  const { device, texture } = scratch()
  let groups = 0
  const createBindGroup = device.createBindGroup.bind(device)
  device.createBindGroup = (desc) => (groups++, createBindGroup(desc))
  const views = (texture as unknown as { views: unknown[] }).views
  oneChain(device, texture, 'rgba8unorm')
  const made = [views.length, groups]
  assert.deepEqual(made, [3, 2], 'one view a level; two reductions')
  for (let picture = 0; picture < 3; picture++) oneChain(device, texture, 'rgba8unorm')
  assert.deepEqual([views.length, groups], made, 'no view nor group again')
})
