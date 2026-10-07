import assert from 'node:assert/strict'
import { test } from 'node:test'
import { peakPlan, rateOf, STREAM_BYTES } from './plan.ts'
import { peakWgsl } from './wgsl.ts'

const bench = (resource: string) => peakPlan().find((b) => b.resource === resource)!

test('each stream benchmark touches its whole buffer once: threads × elements × 16 bytes', () => {
  for (const resource of ['read', 'write', 'copy']) {
    const { size, work } = bench(resource)
    assert.equal(size.threads * size.perThread * 16, STREAM_BYTES)
    assert.equal(work, (resource === 'copy' ? 2 : 1) * STREAM_BYTES)
    const wgsl = peakWgsl(bench(resource))!
    assert.match(wgsl, new RegExp(`const THREADS = ${size.threads}u`))
    assert.match(wgsl, new RegExp(`const PER = ${size.perThread}u`))
  }
})

test('the texel benchmarks count one texel a tap of every thread of their grid', () => {
  for (const resource of ['texelLoad', 'texelFilter']) {
    const { size, work } = bench(resource)
    assert.equal(work, size.grid * size.grid * size.taps)
    assert.match(peakWgsl(bench(resource))!, new RegExp(`k < ${size.taps}u`))
  }
  assert.match(peakWgsl(bench('texelFilter'))!, /textureSampleLevel/)
  assert.doesNotMatch(peakWgsl(bench('texelLoad'))!, /sampler/)
  const stream = bench('textureStream')
  assert.equal(stream.work, stream.size.side ** 2 * 8, 'rgba16float: 8 bytes a texel')
})

test('arithmetic counts two operations a fused multiply-add, 8 lanes a thread', () => {
  const { size, work } = bench('alu')
  assert.equal(work, 2 * size.threads * size.iterations * 8)
  const wgsl = peakWgsl(bench('alu'))!
  assert.equal(wgsl.match(/fma\(/g)?.length, 2, 'two vec4 chains')
  assert.match(wgsl, new RegExp(`i < ${size.iterations}u`))
})

test('workgroup memory counts 16 bytes a read, every thread reading as many as it loops', () => {
  const { size, work } = bench('shared')
  assert.equal(work, size.threads * size.reads * 16)
  assert.match(peakWgsl(bench('shared'))!, new RegExp(`i < ${size.reads}u`))
})

test('the raster benchmarks count a pixel per layer, a triangle per pixel of their target', () => {
  assert.equal(bench('fragments').work, bench('fragments').size.layers * 4096 ** 2)
  assert.equal(bench('fill').work, 4096 ** 2)
  assert.equal(bench('fillMrt4').size.attachments, 4)
  assert.equal((peakWgsl(bench('fillMrt4'))!.match(/@location/g) ?? []).length, 4)
  assert.equal(bench('triangles').work, bench('triangles').size.side ** 2)
  assert.equal(peakWgsl(bench('renderPass')), null, 'a pass with no program')
})

test('a rate is the work over the time in its unit; a fixed cost is its time', () => {
  assert.equal(rateOf(bench('read'), 1), STREAM_BYTES / 1e-3 / 1e9)
  assert.equal(rateOf(bench('computePass'), 0.012), 0.012)
  // A chain of dependent dispatches: its time over the dispatches that paid it.
  assert.equal(rateOf(bench('dependentDispatch'), 3.2), 3.2 / bench('dependentDispatch').work)
  assert.equal(bench('dependentDispatch').work, bench('dependentDispatch').size.dispatches)
})
