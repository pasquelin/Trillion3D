// The base triangles' fallback of a displaced surface in the shadow maps: its displacement, in pixels from the mip view's scale and the object's nearest depth, at or under the size it fades
// out below, gives the surface up to its base triangles, whole, as the reference's instance falls back (`vsmRenderFallsBack`). One or the other, never both.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { CULL } from './renderCullView.fixture.ts'

const { vsmRenderFallsBack } = shaderRun<{
  vsmRenderFallsBack: (candidate: object, focal: number, depth: number) => boolean
}>(CULL, ['vsmRenderFallsBack'], {})

// A displacement of 2 units that fades out under 8 pixels.
const surface = (reach: number, fadeOut: number) => ({ tess: [reach, fadeOut, 0, 0] })

test('a displacement under its fade-out size on the screen is gone: the surface is drawn as its base triangles', () => {
  // 2 units at depth 100 with 100 pixels a unit at depth one: 2 pixels, under 8.
  assert.equal(vsmRenderFallsBack(surface(2, 8), 100, 100), true)
  // At depth 10: 20 pixels, over 8: the patches are drawn.
  assert.equal(vsmRenderFallsBack(surface(2, 8), 100, 10), false)
  // At the size itself it falls back (at or under).
  assert.equal(vsmRenderFallsBack(surface(2, 8), 100, 25), true)
})

test('a surface that never fades, is masked or is not displaced never falls back, nor one the object’s ball reaches the eye of', () => {
  assert.equal(vsmRenderFallsBack(surface(2, 0), 100, 1000), false)
  assert.equal(vsmRenderFallsBack(surface(0, 0), 100, 1000), false)
  assert.equal(vsmRenderFallsBack(surface(2, 8), 100, 0), false)
})
