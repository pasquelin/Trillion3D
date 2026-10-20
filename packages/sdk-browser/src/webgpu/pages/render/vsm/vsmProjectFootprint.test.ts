// Class 1 for what the shadow trace reads of viewToClip (header words 32-47) under the projection
// `vsmProject.ts` uploads (`vsmProject.test.ts`): the old round trip `J(P·V)·V⁻¹` and
// `taaRenderProjection` write it apart — a last bit of an orthographic view's jitter (44, 45), the
// round trip's residue where `W·P` holds an exact zero. Emulated in f32 on `HALTON_SWEEP` cameras
// of an open world, temporal accumulation on and off: a pixel's world size
// (`vsmPixelWorldSize`), so a local light's receiver pixel size and footprint level, its only
// header input, is the same f32.
import test from 'node:test'
import assert from 'node:assert/strict'
import { sweptSamples, viewDepth } from './vsmProject.fixture.ts'

/** `vsmPixelWorldSize` at view depth `depth` under header `h`, in f32. */
function pixelWorld(h: Float32Array, depth: number) {
  const span = Math.min(
    Math.fround(1 / Math.fround(h[92] * h[32])),
    Math.fround(1 / Math.fround(h[93] * h[37])),
  )
  return Math.fround(Math.fround(Math.fround(depth * h[43]) + h[47]) * span)
}

test('class 1: the pixel world size reads the same from either header', () => {
  for (const { old, fresh, z, at } of sweptSamples()) {
    const depth = viewDepth(fresh, z)
    assert.ok(Object.is(pixelWorld(old, depth), pixelWorld(fresh, depth)), at)
  }
})
