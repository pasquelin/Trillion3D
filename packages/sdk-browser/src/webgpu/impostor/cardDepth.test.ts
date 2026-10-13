// A card drawn at the eye keeps its depth: the pass takes the eye off the card's translation in
// two singles a component and projects at the eye (`cardWgsl.ts`), each operation rounded to single
// here as the GPU rounds it. Against the depth in double, out to 10⁵ m, it errs by no more than its
// own roundings allow — and the matrix the CPU composed in double for each card (`toDraw · world`,
// rounded once) neither. The allowance is proven, not measured: with u = 2⁻²⁴ and γₙ = nu/(1 − nu),
// a four-term single dot product of single inputs errs by at most γ₄ Σ|terms|; each input a single
// rounded once (the matrix) or carried with its own error (the relative point) adds its share; the
// quotient of two values off by δz and δw is off by (δz + δw)/(1 − δw), and its rounding by u more.
// An arithmetic that loses more than that fails, whatever the seed. That is the depth the card
// occludes by; the surface stage compares none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { multiplyMatrix4 } from '../../../../sdk-core/src/index.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { fieldCamera } from '../../gpu/dag/placementTree.fixture.ts'
import { singleUlp } from '../../../../../bench/core/ulp.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

const u = 2 ** -24,
  gamma = (n: number) => (n * u) / (1 - n * u)

/** `m · v` in single, each product and sum rounded, `m` column-major and already single. */
function mulSingle(m: ArrayLike<number>, v: readonly number[]) {
  return [0, 1, 2, 3].map((row) => {
    let sum = 0
    for (let col = 0; col < 4; col++)
      sum = Math.fround(sum + Math.fround(m[col * 4 + row] * v[col]))
    return sum
  })
}

/** What row `r` of `mulSingle(fl(m), v)` may err by: the dot product's γ₄, the rounding of `m` to
 *  single, and each input `v[c]` within `slack[c]` of the exact. */
function dotBound(m: ArrayLike<number>, v: readonly number[], slack: readonly number[], r: number) {
  let terms = 0,
    inputs = 0
  for (let c = 0; c < 4; c++) {
    terms += Math.abs(Math.fround(m[c * 4 + r]) * v[c])
    inputs += Math.abs(m[c * 4 + r]) * slack[c]
  }
  return gamma(4) * terms + u * (1 + u) * terms + inputs
}

/** What `fl(ẑ / ŵ)` may err by against `z / w`, in single ULPs at `d = z / w`. */
function depthBound(errorZ: number, errorW: number, z: number, w: number, d: number) {
  const dz = errorZ / Math.abs(z),
    dw = errorW / Math.abs(w),
    q = (dz + dw) / (1 - dw)
  return ((q + u * (1 + q)) * Math.abs(d)) / singleUlp(d)
}

test('a card at the eye keeps its depth within what its roundings allow, to 10⁵ m', () => {
  const next = lcgRandom(3)
  let before = 0,
    after = 0
  for (let i = 0; i < 400; i++) {
    const far = 10 ** (2 + 3 * next()),
      origin = [1e5 * (next() - 0.5), 20, 1e5 * (next() - 0.5)]
    const eye = [origin[0], origin[1] + 2, origin[2]],
      a = 2 * Math.PI * next()
    const pivot = [eye[0] + far * Math.sin(a), 0, eye[2] - far * Math.cos(a)]
    const cam = engineCamera(fieldCamera(eye, pivot, 1e7)),
      s = 1 + next()
    const world = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, pivot[0], pivot[1], pivot[2], 1]
    const point = [3 * (next() - 0.5), 3 * next(), 3 * (next() - 0.5), 1].map(Math.fround)
    // The reference, in double.
    const toDraw = multiplyMatrix4(
      new Float64Array(16),
      cam.viewProjection,
      Float64Array.from(world),
    )
    const exact = [0, 1, 2, 3].map((r) =>
      [0, 1, 2, 3].reduce((sum, c) => sum + toDraw[c * 4 + r] * point[c], 0),
    )
    // Before: the matrix composed in double, rounded once, applied in single.
    const old = mulSingle(Float32Array.from(toDraw), point)
    // Now: the translation's two words less the eye's, the linear part, then the matrix at the eye.
    const at = Array.from(cam.viewProjection)
    for (let r = 0; r < 4; r++)
      at[12 + r] +=
        cam.viewProjection[r] * eye[0] +
        cam.viewProjection[4 + r] * eye[1] +
        cam.viewProjection[8 + r] * eye[2]
    // Each relative coordinate, and what it may err by: its five roundings, the split's residues
    // and the scale's product (`γ₂`).
    const slack = [0, 0, 0, 0]
    const relative = [0, 1, 2].map((k) => {
      const high = Math.fround(world[12 + k]),
        low = Math.fround(world[12 + k] - high),
        eyeHigh = Math.fround(eye[k]),
        eyeLow = Math.fround(eye[k] - eyeHigh)
      const linear = Math.fround(
        Math.fround(
          Math.fround(Math.fround(world[k]) * point[0]) +
            Math.fround(Math.fround(world[4 + k]) * point[1]),
        ) + Math.fround(Math.fround(world[8 + k]) * point[2]),
      )
      const step = Math.fround(high - eyeHigh),
        residue = Math.fround(low - eyeLow),
        translation = Math.fround(step + residue),
        coordinate = Math.fround(linear + translation)
      const scaled = [0, 1, 2].reduce((sum, c) => sum + Math.abs(world[c * 4 + k] * point[c]), 0)
      slack[k] =
        (u * (Math.abs(step) + Math.abs(residue) + Math.abs(translation) + Math.abs(coordinate)) +
          u * (Math.abs(world[12 + k] - high) + Math.abs(eye[k] - eyeHigh))) *
          (1 + 4 * u) +
        gamma(4) * scaled * (1 + u)
      return coordinate
    })
    const input = [...relative, 1],
      now = mulSingle(Float32Array.from(at), input)
    const depth = exact[2] / exact[3]
    // Single ULPs at the double's depth: the distance in its binade, a fraction of one included.
    const errorNow = Math.abs(Math.fround(now[2] / now[3]) - depth) / singleUlp(depth),
      errorOld = Math.abs(Math.fround(old[2] / old[3]) - depth) / singleUlp(depth)
    const zero = [0, 0, 0, 0],
      [zNow, wNow, zOld, wOld] = [
        dotBound(at, input, slack, 2),
        dotBound(at, input, slack, 3),
        dotBound(toDraw, point, zero, 2),
        dotBound(toDraw, point, zero, 3),
      ]
    const allowedNow = depthBound(zNow, wNow, exact[2], exact[3], depth),
      allowedOld = depthBound(zOld, wOld, exact[2], exact[3], depth)
    assert.ok(
      errorNow <= allowedNow,
      `card ${i} at the eye: ${errorNow} ULP, ${allowedNow} allowed`,
    )
    assert.ok(errorOld <= allowedOld, `card ${i} composed: ${errorOld} ULP, ${allowedOld} allowed`)
    before = Math.max(before, errorOld)
    after = Math.max(after, errorNow)
  }
  console.log(`depth error: ${after.toFixed(2)} ULP at the eye, ${before.toFixed(2)} composed`)
})
