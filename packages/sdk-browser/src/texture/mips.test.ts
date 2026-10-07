// A chain's levels reduce on the device without waiting for it: held uniforms grown by powers of
// two, one pipeline a rule, sRGB levels read decoded, one labelled pass, views and groups made once.
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateMaterialMips } from './mipBatch.ts'
import { mipLevelCountFor } from './tiles.ts'
import { TEXTURE_MIPS_PASS } from './mipsPass.ts'
import { REDUCE, oneChain, scratch, wider } from './mips.fixture.ts'

test('reduction submits without waiting for the device and keeps its buffers', () => {
  const { device, texture, buffers, submits } = scratch()
  const before = buffers.length
  oneChain(device, texture, 'rgba8unorm', false)
  oneChain(device, texture, 'rgba8unorm', false)
  assert.equal(submits.length, 2, 'both chains went out')
  assert.equal(
    buffers.length - before,
    2,
    'one uniform and one bin buffer for both, never destroyed',
  )
})

// A batch outgrowing the held uniforms grows them to the next power of two, the outgrown buffer
// destroyed once the work already submitted, which may read it, is done.
test('uniforms take a block a level, at the alignment, grown by powers of two', async () => {
  const { device, texture, buffers, writes } = scratch()
  oneChain(device, texture, 'rgba8unorm', false)
  const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment ?? 256)
  assert.equal(writes[0].bytes.byteLength, mipLevelCountFor(4, 4) * stride)
  const sixteen = wider(device, texture, 16)
  generateMaterialMips(device, [
    { texture: sixteen, format: 'rgba8unorm', width: 16, height: 16, weighted: false },
  ])
  const uniforms = (
    buffers as unknown as { label: string; size: number; destroyed: boolean }[]
  ).filter(({ label }) => label === 'Trillion3D texture mips uniforms')
  assert.deepEqual(
    uniforms.map(({ size }) => size),
    [1024, 2048],
    '3 then 5 blocks of 256 bytes',
  )
  assert.equal(uniforms[0].destroyed, false, 'kept while the queue may read it')
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(
    uniforms.map(({ destroyed }) => destroyed),
    [true, false],
  )
})

// #42: the weighted rule is a pipeline of its own, built with the `weighted` constant; the plain one
// keeps it off. An sRGB chain encodes its levels again (`srgb`). The compiler proves the rule's bytes
// (`texture_preview/tests/weighted_colour.rs`); which texture takes which rule is `scratch.test.ts`
// and `sourcesWeighted.test.ts`.
test('one reduction pipeline per rule, the weighted and sRGB ones built with their constants', () => {
  const { device, texture, computePipelines } = scratch()
  for (const rule of [true, false, true]) oneChain(device, texture, 'rgba8unorm-srgb', rule)
  oneChain(device, texture, 'rgba8unorm', false)
  const reductions = computePipelines.filter(({ compute }) => compute.entryPoint === REDUCE)
  assert.deepEqual(
    reductions.map(({ compute }) => compute.constants),
    [
      { weighted: 1, srgb: 1 },
      { weighted: 0, srgb: 1 },
      { weighted: 0, srgb: 0 },
    ],
  )
})

// A colour level is read decoded through its sRGB view — sampled alone (4), WebGPU refusing an sRGB
// view with storage usage — and written through the texture's own `rgba8unorm` storage view.
test('a level reads the one above in the pool format and writes its own storage view', () => {
  const { device, texture } = scratch()
  const groups: GPUBindGroupEntry[][] = [],
    createBindGroup = device.createBindGroup.bind(device)
  device.createBindGroup = (desc) => (groups.push([...desc.entries]), createBindGroup(desc))
  oneChain(device, texture, 'rgba8unorm-srgb', false)
  const view = (entries: GPUBindGroupEntry[], binding: number) =>
    entries.find((entry) => entry.binding === binding)!.resource as GPUTextureViewDescriptor
  assert.equal(groups.length, 2, 'one group a level')
  for (const entries of groups) {
    assert.deepEqual([view(entries, 0).format, view(entries, 0).usage], ['rgba8unorm-srgb', 4])
    assert.equal(view(entries, 3).format, 'rgba8unorm')
  }
})

// #685: the pass carries its label, so no pass the engine begins is unnamed; nothing is drawn.
test('a chain’s counts and reductions run in one labelled compute pass', () => {
  const { device, texture, passes, commands } = scratch()
  oneChain(device, texture, 'rgba8unorm-srgb', true, 128)
  assert.deepEqual(commands, ['clear', `compute ${TEXTURE_MIPS_PASS}`])
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
  oneChain(device, texture, 'rgba8unorm', false, 128)
  const made = [views.length, groups]
  assert.deepEqual(
    made,
    [3, 2 + 3 + 1],
    'one view a level; two reductions, three counts, the picks',
  )
  for (let picture = 0; picture < 3; picture++) oneChain(device, texture, 'rgba8unorm', true, 99)
  assert.deepEqual([views.length, groups], made, 'the rule and cutoff move no group')
})
