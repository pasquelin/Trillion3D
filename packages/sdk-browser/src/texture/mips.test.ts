import test from 'node:test'
import assert from 'node:assert/strict'
import { generateMaterialMips } from './mipBatch.ts'
import { mipLevelCountFor } from './tiles.ts'
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../tests/kit/gpu/mockGpu.ts'
import { TEXTURE_MIPS_PASS } from './mipsPass.ts'

/** The reduction's entry point. */
const REDUCE = 'reduceLevel'

/** One chain alone: a 4×4 texture under `format`, its rule and its cutoff. */
const oneChain = (
  device: GPUDevice,
  texture: GPUTexture,
  format: GPUTextureFormat,
  weighted: boolean,
  cutoff?: number,
) => generateMaterialMips(device, [{ texture, format, width: 4, height: 4, weighted, cutoff }])

/** A four-texel-wide working texture, as tiles of a host texture cut them. */
function scratch() {
  installGpuGlobals()
  const gpu = mockGpu()
  const texture = gpu.device.createTexture({
    size: { width: 4, height: 4, depthOrArrayLayers: 1 },
    // Read in sRGB too, as a colour chain's levels are (`materialMipTexture`).
    format: 'rgba8unorm',
    viewFormats: ['rgba8unorm-srgb'],
    mipLevelCount: mipLevelCountFor(4, 4),
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  }) as unknown as GPUTexture
  return { ...gpu, texture }
}

/** A working texture like `texture`, `side` texels wide, its whole chain. */
const wider = (device: GPUDevice, texture: GPUTexture, side: number) =>
  device.createTexture({
    ...texture,
    size: [side, side],
    mipLevelCount: mipLevelCountFor(side, side),
  })

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
// and `sources.test.ts`.
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

// #748: a chain with a cutoff counts each level — level 0 first — and picks its `t` before reducing
// it, every level's block carrying the cutoff and its first bin word, the reduction reading `t` from
// the bins; one without counts nothing. The shaders' arithmetic is `coverageRule.test.ts`.
test('a chain with a cutoff counts each level before reducing it, a plain one nothing', () => {
  const { device, texture, computes, writes } = scratch()
  oneChain(device, texture, 'rgba8unorm-srgb', true, 128)
  assert.deepEqual(computes, ['count', 'count', 'choose', REDUCE, 'count', 'choose', REDUCE])
  const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment ?? 256) / 4
  const blocks = (at: number) => {
    const words = new Uint32Array(writes[at].bytes.buffer)
    return [0, 1, 2].map((block) => [...words.subarray(block * stride, block * stride + 7)])
  }
  const levels = [
    [4, 4, 128, 0, 4, 4, 0],
    [4, 4, 128, 0, 4, 4, 1],
    [2, 2, 128, 0, 4, 4, 2],
  ]
  assert.deepEqual(blocks(0), levels)
  oneChain(device, texture, 'rgba8unorm-srgb', true)
  assert.deepEqual(computes.slice(7), [REDUCE, REDUCE], 'a plain chain counts nothing')
  assert.deepEqual(
    blocks(1),
    levels.map((block) => [...block.slice(0, 2), 0, ...block.slice(3)]),
  )
})

// OMB-29, #961: a batch is one uniform write, one bin clear, one compute pass and one submit; its
// chains go level by level — a level's counts, picks, then reductions —, each in the order it had
// alone, its uniform blocks after the previous chain's, a 1×1 chain nothing.
test('a batch writes its chains’ blocks once, in order, and reduces them in one pass', () => {
  const { device, texture, computes, writes, submits, commands } = scratch()
  const offsets: number[] = []
  const createBindGroup = device.createBindGroup.bind(device)
  device.createBindGroup = (desc) => {
    for (const { binding, resource } of desc.entries)
      if (binding === 1 && 'offset' in resource) offsets.push(resource.offset! / 256)
    return createBindGroup(desc)
  }
  const eight = wider(device, texture, 8)
  generateMaterialMips(device, [
    { texture, format: 'rgba8unorm-srgb', width: 4, height: 4, weighted: true, cutoff: 128 },
    { texture, format: 'rgba8unorm', width: 1, height: 1, weighted: false },
    { texture: eight, format: 'rgba8unorm', width: 8, height: 8, weighted: false },
  ])
  assert.equal(submits.length, 1)
  assert.equal(writes.length, 1)
  assert.deepEqual(commands, ['clear', `compute ${TEXTURE_MIPS_PASS}`])
  assert.deepEqual(computes, [
    ...['count', 'count', 'choose', REDUCE, REDUCE],
    ...['count', 'choose', REDUCE, REDUCE],
    REDUCE,
  ])
  // The first chain's reductions bind blocks 1, 2, its counts 0, 1, 2; the second chain's 4–6.
  assert.deepEqual(offsets, [1, 2, 0, 1, 2, 4, 5, 6])
  const words = new Uint32Array(writes[0].bytes.buffer)
  const block = (at: number) => [...words.subarray(at * 64, at * 64 + 7)]
  assert.deepEqual(block(2), [2, 2, 128, 0, 4, 4, 2])
  assert.deepEqual(block(3), [8, 8, 0, 0, 8, 8, 0])
  assert.deepEqual(block(6), [2, 2, 0, 0, 8, 8, 3])
})

// A level's picks are one dispatch over every cutting chain: the pick blocks follow the chains',
// then the table of each cutting chain's first block and levels, those reaching deepest first.
test('a batch picks a level of all its cutting chains in one dispatch', () => {
  const { device, texture, computes, writes } = scratch()
  const eight = wider(device, texture, 8)
  generateMaterialMips(device, [
    { texture, format: 'rgba8unorm', width: 4, height: 4, weighted: false, cutoff: 128 },
    { texture: eight, format: 'rgba8unorm', width: 8, height: 8, weighted: false, cutoff: 64 },
  ])
  assert.equal(computes.filter((entry) => entry === 'choose').length, 3, 'one a level')
  const words = new Uint32Array(writes[0].bytes.buffer)
  // Blocks 0–2 the 4×4's, 3–6 the 8×8's, 7–10 the picks', then the table.
  assert.deepEqual([...words.subarray(8 * 64, 8 * 64 + 3)], [1, 11 * 64, 64])
  assert.deepEqual([...words.subarray(11 * 64)], [3, 4, 0, 3])
  assert.equal(words[3 * 64 + 3], 3 * 256, 'the 8×8’s bins follow the 4×4’s')
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
