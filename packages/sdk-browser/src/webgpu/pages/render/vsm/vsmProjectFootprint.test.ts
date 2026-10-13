// Class 1 for what the shadow trace reads of viewToClip (header words 32-47) under the projection
// `vsmProject.ts` uploads (`vsmProject.test.ts`): the old round trip `J(P·V)·V⁻¹` and
// `taaRenderProjection` write it apart — a last bit of an orthographic view's jitter (44, 45), the
// round trip's residue where `W·P` holds an exact zero. Emulated in f32 on `HALTON_SWEEP` cameras
// of an open world, temporal accumulation on and off: a pixel's world size
// (`vsmPixelWorldSize`), so a local light's receiver pixel size and footprint level, its only
// header input, is the same f32; the sun's ray spread on screen (`vsmSunRaySpread`), which sets
// whether a pixel's rays fall within one pixel, is the same f32 from the same view point, and
// moves only where the rebuilt point moved one f32 step (`vsmProjectTexel.test.ts`): counted,
// bounded.
import test from 'node:test'
import assert from 'node:assert/strict'
import { haltonSpan } from '../../../../../../math/src/sequence/sweep.fixture.ts'
import { sweptSamples, transform, viewDepth } from './vsmProject.fixture.ts'

const dot = (a: number[], b: number[]) =>
  Math.fround(
    Math.fround(Math.fround(a[0] * b[0]) + Math.fround(a[1] * b[1])) + Math.fround(a[2] * b[2]),
  )

/** `vsmPixelWorldSize` at view depth `depth` under header `h`, in f32. */
function pixelWorld(h: Float32Array, depth: number) {
  const span = Math.min(
    Math.fround(1 / Math.fround(h[92] * h[32])),
    Math.fround(1 / Math.fround(h[93] * h[37])),
  )
  return Math.fround(Math.fround(Math.fround(depth * h[43]) + h[47]) * span)
}

/** `vsmAcrossLightOnScreen` of `e` under header `h`, in f32. */
function across(
  h: Float32Array,
  e: number[],
  l: number[],
  n: number[],
  nl: number,
  ndc: number[],
  toPixels: number[],
) {
  const k = Math.fround(dot(n, e) / nl),
    onPlane = e.map((x, q) => Math.fround(x - Math.fround(l[q] * k)))
  const v = transform(h.subarray(16, 32), onPlane[0], onPlane[1], onPlane[2], 0)
  const c = transform(h.subarray(32, 48), v[0], v[1], v[2], 0)
  return [0, 1].map((q) =>
    Math.fround(Math.fround(c[q] - Math.fround(ndc[q] * c[3])) * toPixels[q]),
  )
}

/** `vsmSunRaySpread`'s largest stretch σ for light `l`, normal `n`, view point `p`, under header
 *  `h`, in f32 (its two outputs are σ times the light's numbers). */
function stretch(h: Float32Array, l: number[], n: number[], p: number[]) {
  const nl = dot(n, l),
    clip = transform(h.subarray(32, 48), p[0], p[1], p[2], 1)
  const ndc = [Math.fround(clip[0] / clip[3]), Math.fround(clip[1] / clip[3])],
    toPixels = [
      Math.fround(Math.fround(0.5 * h[92]) / clip[3]),
      Math.fround(Math.fround(0.5 * h[93]) / clip[3]),
    ]
  // `frameAround(l)`: two directions across the light.
  const s = l[2] >= 0 ? 1 : -1,
    a = Math.fround(-1 / Math.fround(s + l[2])),
    b = Math.fround(Math.fround(l[0] * l[1]) * a)
  const x = [
      Math.fround(1 + Math.fround(Math.fround(Math.fround(s * a) * l[0]) * l[0])),
      Math.fround(s * b),
      Math.fround(-s * l[0]),
    ],
    y = [b, Math.fround(s + Math.fround(Math.fround(a * l[1]) * l[1])), Math.fround(-l[1])]
  const u = across(h, x, l, n, nl, ndc, toPixels),
    v = across(h, y, l, n, nl, ndc, toPixels)
  const gx = Math.fround(Math.fround(u[0] * u[0]) + Math.fround(u[1] * u[1])),
    gy = Math.fround(Math.fround(v[0] * v[0]) + Math.fround(v[1] * v[1])),
    gz = Math.fround(Math.fround(u[0] * v[0]) + Math.fround(u[1] * v[1])),
    d = Math.fround(0.5 * Math.fround(gx - gy))
  return Math.fround(
    Math.sqrt(
      Math.fround(
        Math.fround(0.5 * Math.fround(gx + gy)) +
          Math.fround(Math.sqrt(Math.fround(Math.fround(d * d) + Math.fround(gz * gz)))),
      ),
    ),
  )
}

/** Sample `key`'s receiver normal: 0 to 87° off the light `l`, toward a swept side. */
function normalOff(l: number[], key: number) {
  const r = [47, 53, 59].map((b) => haltonSpan(key, b, -1, 1)),
    side = [l[1] * r[2] - l[2] * r[1], l[2] * r[0] - l[0] * r[2], l[0] * r[1] - l[1] * r[0]],
    length = Math.hypot(side[0], side[1], side[2]),
    angle = haltonSpan(key, 61, 0, 1.52)
  return l.map((x, q) => Math.fround(x * Math.cos(angle) + (side[q] / length) * Math.sin(angle)))
}

test('class 1: the pixel world size and the sun ray spread read the same from either header', () => {
  // Measured: the spread moves only at the 5 of 524 288 samples whose rebuilt point moved one f32
  // step, by at most one f32 step of itself (10⁻⁷).
  let moved = 0,
    widest = 0
  for (const { old, fresh, sun, z, key, point, own, at } of sweptSamples()) {
    const depth = viewDepth(fresh, z)
    assert.ok(Object.is(pixelWorld(old, depth), pixelWorld(fresh, depth)), at)
    const n = normalOff(sun, key),
      view = transform(fresh.subarray(16, 32), point[0], point[1], point[2], 1)
    const spread = stretch(fresh, sun, n, view)
    assert.ok(Object.is(stretch(old, sun, n, view), spread), at)
    if (own.every((x, k) => x === point[k])) continue
    moved++
    const ownView = transform(old.subarray(16, 32), own[0], own[1], own[2], 1)
    widest = Math.max(widest, Math.abs(stretch(old, sun, n, ownView) / spread - 1))
  }
  assert.equal(moved, 5)
  assert.ok(widest <= 1e-7, `${widest}`)
})
