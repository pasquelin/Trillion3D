// #748, OMB-29, #961: chains with a cutoff count each level before picking and reducing it, and a
// batch of chains is one uniform write, one bin clear, one compute pass and one submit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateMaterialMips } from './mipBatch.ts'
import { TEXTURE_MIPS_PASS } from './mipsPass.ts'
import { REDUCE, oneChain, scratch, wider } from './mips.fixture.ts'

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
