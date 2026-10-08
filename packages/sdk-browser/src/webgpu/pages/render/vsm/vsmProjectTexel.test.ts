// Class 1 for the shadow projection's projection (`vsmProject.ts`, `vsmProject.test.ts`): of the
// view header the pass uploads from the old round trip and from `taaRenderProjection`, only the
// projection's matrices differ (shiftedToClip, viewToClip, clipToShifted), and the pixel's shifted
// position the shader rebuilds from either, emulated in f32, reads the same shadow texels — on
// `HALTON_SWEEP` cameras of an open world, temporal accumulation on and off.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createVsmClipmap, type VsmClipmap } from '../../../../vsm/clipmap.ts'
import { VsmCacheManager } from '../../../../vsm/cacheManager.ts'
import { haltonSpan } from '../../../../../../math/src/sequence/sweep.fixture.ts'
import {
  cam,
  f,
  now,
  pixelSamples,
  shifted,
  sweptHeaders,
  transform,
} from './vsmProject.fixture.ts'

/** The header words the projection feeds: shiftedToClip (0-15), viewToClip (32-47),
 *  clipToShifted (48-63). */
const fromProjection = (k: number) => k < 16 || (k >= 32 && k < 64)

test('of the two headers only the projection matrices differ, the view and screen words are bits', () => {
  // shiftedToView, the origin shift, the eye, the forward axis, the depth decode (80-83), the
  // screen ray scale and field tangents (84-91) read the same f32 words from either.
  for (const { old, fresh, at } of sweptHeaders())
    for (let k = 0; k < 104; k++)
      if (!fromProjection(k)) assert.ok(Object.is(old[k], fresh[k]), `${at} word ${k}`)
})

/** The sun texel the clipmap reads at shifted point `s`: the level of its distance, then
 *  `vec2u(mapUv · 16384)` on that level's shifted-to-UV matrix, all in f32; the light's numbers
 *  are the same for both headers, only the point differs. */
function texel(clipmap: VsmClipmap, view: ArrayLike<number>, s: number[]) {
  const levels = clipmap.cacheEntry.mapCaches.map((m) => m.projectionData)
  const base = levels[0],
    d = s.map((x, a) => f(x + f(base.originShift[a] - view[a] - base.clipmapOrigin[a])))
  const level = 0.5 * Math.log2(f(f(f(d[0] * d[0]) + f(d[1] * d[1])) + f(d[2] * d[2])) * 1e4)
  const k = Math.min(
    Math.max(Math.floor(level + base.levelBias) - base.mapLevel, 0),
    levels.length - 1,
  )
  const at = levels[k],
    p = s.map((x, a) => f(x + f(at.originShift[a] - view[a])))
  const uv = transform(at.shiftedToMapUv, p[0], p[1], p[2], 1)
  return `${k}:${Math.floor(f(uv[0] * 16384))}:${Math.floor(f(uv[1] * 16384))}`
}

test('class 1: every pixel rebuilt from either projection reads the same shadow texel', () => {
  // clipToShifted differs in a few words a camera — the round trip's residues where `W·P` holds
  // an exact zero, a last bit elsewhere —; the rebuilt positions, by one f32 step, in 5 of these
  // 524 288 samples (16 pixels by 4 depths a camera, near plane to 2¹⁷ times it, every clipmap
  // level, accumulation on and off), never across a texel.
  for (const { i, width, height, old, fresh, at } of sweptHeaders()) {
    const viewShift = old.subarray(64, 67)
    const light = { id: 'sun', direction: [37, 41, 43].map((b) => haltonSpan(i, b, -1, 1)) }
    const seen = {
      view: cam.view,
      projection: now,
      perspective: cam.perspective === 1,
      eye: cam.eye,
    }
    const clipmap = createVsmClipmap(new VsmCacheManager(), light, seen, { width, height }, 0)
    for (const { px, py, z } of pixelSamples(i, width, height)) {
      const a = shifted(old, px, py, z),
        b = shifted(fresh, px, py, z)
      assert.equal(texel(clipmap, viewShift, a), texel(clipmap, viewShift, b), at)
    }
  }
})
