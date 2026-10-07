// The sun's ray spread (`vsmSunRaySpread`, `traceWgsl.ts`) is the largest stretch of a
// displacement across the light, carried along it onto the receiver's plane, then onto the screen:
// over generated receivers (planes facing the light from straight on to nearly edge-on, points
// across a perspective view's frustum, near and far), no direction across the light lands farther
// on screen than it says, and one lands within a hundredth of it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun, Mat } from '../texture/shaderRun.fixture.ts'
import { CODE, constructors, IDENTITY, unit } from './pageWorld.fixture.ts'
import { FLOAT32_MAX } from '../../../math/src/constants.ts'

const W = 1920,
  H = 1080,
  COT = 1 / Math.tan((55 * Math.PI) / 360)
/** View +Z forward, w = z (reverse-Z), a small off-centre term as a jittered view has. */
const VIEW_TO_CLIP = new Mat([
  COT / (W / H),
  0,
  0,
  0,
  0,
  COT,
  0,
  0,
  3e-4,
  -2e-4,
  0,
  1,
  0,
  0,
  0.1,
  0,
])

const { vsmSunRaySpread } = shaderRun<{
  vsmSunRaySpread: (...a: unknown[]) => number[]
}>(CODE, ['vsmSunRaySpread', 'vsmAcrossLightOnScreen', 'frameAround'], {
  ...constructors(CODE),
  vsmView: {
    viewToClip: VIEW_TO_CLIP,
    shiftedToView: IDENTITY,
    viewPixels: [W, H, 1 / W, 1 / H],
  },
})

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (v: number[]) => v.map((x) => x / Math.hypot(...v))
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
/** A view point's pixel. */
function pixel(p: number[]) {
  const m = VIEW_TO_CLIP.m,
    c = [0, 1, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
  return [((c[0] / c[2]) * W) / 2, ((c[1] / c[2]) * H) / 2]
}

test('no displacement across the light lands farther on screen than the spread says', () => {
  for (let k = 0; k < 400; k++) {
    const r = (j: number) => unit(1468, k, j)
    const l = norm([r(1) - 0.5, r(2) - 0.5, r(3) - 0.5])
    // A normal at an angle to the light from 0 to about 87°.
    const side = norm(cross(l, [r(4) - 0.5, r(5) - 0.5, r(6) - 0.5]))
    const angle = r(7) * 1.52,
      n = l.map((x, i) => x * Math.cos(angle) + side[i] * Math.sin(angle))
    const z = 0.5 + 60 * r(8),
      v = [(r(9) - 0.5) * 1.6 * z, (r(10) - 0.5) * 0.9 * z, z]
    const [perDepth, dither] = vsmSunRaySpread(l, 0.0047, n, v, 3e-4, 0.25)
    const sigma = perDepth / (2 * 0.0047)
    assert.ok(Math.abs(dither / (sigma * Math.SQRT2 * (3e-4 / 0.25)) - 1) < 1e-5)
    const a = norm(cross(l, side)),
      b = cross(l, a),
      eps = 1e-5 * z,
      from = pixel(v)
    let most = 0
    for (let d = 0; d < 256; d++) {
      const t = (Math.PI * d) / 256,
        e = a.map((x, i) => x * Math.cos(t) + b[i] * Math.sin(t)),
        onPlane = e.map((x, i) => x - (l[i] * dot(n, e)) / dot(n, l)),
        to = pixel(v.map((x, i) => x + eps * onPlane[i])),
        stretch = Math.hypot(to[0] - from[0], to[1] - from[1]) / eps
      assert.ok(stretch <= sigma * 1.001, `receiver ${k}: ${stretch} past ${sigma}`)
      most = Math.max(most, stretch)
    }
    assert.ok(most >= sigma * 0.99, `receiver ${k}: ${most} under ${sigma}`)
  }
})

test('a receiver facing away from the light or edge-on spreads without bound', () => {
  for (const n of [
    [0, 0, -1],
    [1, 0, 0],
  ])
    // f32's greatest value, as the GPU stores the literal.
    assert.deepEqual(vsmSunRaySpread([0, 0, 1], 0.0047, n, [0, 0, 5], 1e-4, 1).map(Math.fround), [
      FLOAT32_MAX,
      FLOAT32_MAX,
    ])
})
