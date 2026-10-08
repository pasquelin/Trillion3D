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
import { f, sweptSamples, transform, viewDepth } from './vsmProject.fixture.ts'

const dot = (a: number[], b: number[]) => f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]))

/** `vsmPixelWorldSize` at view depth `depth` under header `h`, in f32. */
function pixelWorld(h: Float32Array, depth: number) {
  const span = Math.min(f(1 / f(h[92] * h[32])), f(1 / f(h[93] * h[37])))
  return f(f(f(depth * h[43]) + h[47]) * span)
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
  const k = f(dot(n, e) / nl),
    onPlane = e.map((x, q) => f(x - f(l[q] * k)))
  const v = transform(h.subarray(16, 32), onPlane[0], onPlane[1], onPlane[2], 0)
  const c = transform(h.subarray(32, 48), v[0], v[1], v[2], 0)
  return [0, 1].map((q) => f(f(c[q] - f(ndc[q] * c[3])) * toPixels[q]))
}

/** `vsmSunRaySpread`'s largest stretch σ for light `l`, normal `n`, view point `p`, under header
 *  `h`, in f32 (its two outputs are σ times the light's numbers). */
function stretch(h: Float32Array, l: number[], n: number[], p: number[]) {
  const nl = dot(n, l),
    clip = transform(h.subarray(32, 48), p[0], p[1], p[2], 1)
  const ndc = [f(clip[0] / clip[3]), f(clip[1] / clip[3])],
    toPixels = [f(f(0.5 * h[92]) / clip[3]), f(f(0.5 * h[93]) / clip[3])]
  // `frameAround(l)`: two directions across the light.
  const s = l[2] >= 0 ? 1 : -1,
    a = f(-1 / f(s + l[2])),
    b = f(f(l[0] * l[1]) * a)
  const x = [f(1 + f(f(f(s * a) * l[0]) * l[0])), f(s * b), f(-s * l[0])],
    y = [b, f(s + f(f(a * l[1]) * l[1])), f(-l[1])]
  const u = across(h, x, l, n, nl, ndc, toPixels),
    v = across(h, y, l, n, nl, ndc, toPixels)
  const gx = f(f(u[0] * u[0]) + f(u[1] * u[1])),
    gy = f(f(v[0] * v[0]) + f(v[1] * v[1])),
    gz = f(f(u[0] * v[0]) + f(u[1] * v[1])),
    d = f(0.5 * f(gx - gy))
  return f(Math.sqrt(f(f(0.5 * f(gx + gy)) + f(Math.sqrt(f(f(d * d) + f(gz * gz)))))))
}

/** Sample `key`'s receiver normal: 0 to 87° off the light `l`, toward a swept side. */
function normalOff(l: number[], key: number) {
  const r = [47, 53, 59].map((b) => haltonSpan(key, b, -1, 1)),
    side = [l[1] * r[2] - l[2] * r[1], l[2] * r[0] - l[0] * r[2], l[0] * r[1] - l[1] * r[0]],
    length = Math.hypot(side[0], side[1], side[2]),
    angle = haltonSpan(key, 61, 0, 1.52)
  return l.map((x, q) => f(x * Math.cos(angle) + (side[q] / length) * Math.sin(angle)))
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
