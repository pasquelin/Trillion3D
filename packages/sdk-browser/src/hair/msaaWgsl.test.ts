// The hardware raster of the visibility: its passes, and the text of its programs.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { HairSampleCount } from './visibilityMath.ts'
import {
  HAIR_MSAA_SAMPLES,
  hairMsaaPasses,
  MSAA_FILL_WGSL,
  MSAA_WGSL,
  msaaResolveWgsl,
} from './msaaWgsl.ts'

test('a pass draws four samples a pixel, so 2 and 4 take one pass and 8 two', () => {
  assert.equal(HAIR_MSAA_SAMPLES, 4)
  assert.deepEqual(
    [2, 4, 8].map((samples) => hairMsaaPasses(samples as HairSampleCount)),
    [1, 1, 2],
  )
})

test('the ribbons are drawn whole or not at all, and the opaque depth is written first', () => {
  const vertex = MSAA_WGSL.slice(
    MSAA_WGSL.indexOf('fn hairVisibilityVs'),
    MSAA_WGSL.indexOf('fn hairVisibilityFs'),
  )
  // A segment whose ends have no side is six vertices at one point: no half-drawn ribbon.
  assert.ok(vertex.indexOf('!first.ok||!second.ok') < vertex.indexOf('cornerClip('))
  assert.match(MSAA_FILL_WGSL, /@builtin\(frag_depth\)/)
  // The fill is drawn over the tiles with strands alone: a quad a listed tile, not the whole image.
  assert.match(MSAA_FILL_WGSL, /hairTileQuad\(vertex,tiles\[/)
  assert.ok(!MSAA_FILL_WGSL.includes('fullscreen'))
  assert.match(MSAA_WGSL, /override SHIFT_X/)
})

test('the resolve places a sample by the visibility write of the software raster, in both forms', () => {
  const wide = msaaResolveWgsl(8, true)
  const split = msaaResolveWgsl(8, false)
  assert.ok(wide.includes('atomicStoreMax'))
  assert.equal(wide.split('visWrite(at,key,code').length, 2, 'one write with the 64-bit word')
  assert.equal(
    split.split('visWrite(at,key,code').length,
    3,
    'a depth write then an identifier write',
  )
  assert.match(split, /pixel\.y<band\.first\|\|pixel\.y>=band\.end/)
})
