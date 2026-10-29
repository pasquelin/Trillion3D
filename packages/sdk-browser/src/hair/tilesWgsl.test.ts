// The tiles with strands: the widening of the partial lists, and the sample buffers a forward image asks.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SUBGROUP_TILES_WGSL, WORKGROUP_TILES_WGSL } from './tilesWgsl.ts'
import { allocateSamples } from './viewGpu.ts'

test('a tile is partial when a pixel or its neighbour holds a strand and the image asks to widen, full only by its own pixels', () => {
  for (const code of [WORKGROUP_TILES_WGSL, SUBGROUP_TILES_WGSL]) {
    assert.match(code, /image\.dilate!=0u&&!partial/)
    assert.match(code, /vec2i\(i32\(k%3u\)-1,i32\(k\/3u\)-1\)/)
    assert.match(code, /return vec2<bool>\(t<=1\.0-image\.fullCoverage,partial\)/)
  }
})

test('a forward image allocates the lists of tiles and no band, window nor list of large ribbons', () => {
  ;(globalThis as { GPUBufferUsage?: object }).GPUBufferUsage ??= {}
  const bought: string[] = []
  const allocator = {
    buffer: (label: string) => (bought.push(label), { label }),
  } as unknown as Parameters<typeof allocateSamples>[0]
  const forward = allocateSamples(allocator, 64, 64, 2, 64, 16, 0, false, true)
  assert.equal(forward.samples.length, 0)
  assert.equal(forward.windows.length, 0)
  assert.equal(forward.large, undefined)
  assert.equal(forward.largeArgs, undefined)
  assert.ok(bought.length > 0 && bought.every((label) => !/samples|window|large/.test(label)))
  const sampled = allocateSamples(allocator, 64, 64, 2, 64, 16, 0, false, false)
  assert.equal(sampled.samples.length, 1)
  assert.ok(sampled.large)
})
