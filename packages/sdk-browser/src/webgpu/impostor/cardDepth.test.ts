// A card drawn at the eye keeps its depth: the pass takes the eye off the card's translation in
// two singles a component and projects at the eye (`cardWgsl.ts`), each operation rounded to single
// here as the GPU rounds it. Against the depth in double it stays within three units in the last
// place, out to 10⁵ m — the matrix the CPU composed in double for each card (`toDraw · world`,
// rounded once) within two —, far inside the surface stage's nudge of 2⁻²⁰ (16 of them).
import test from 'node:test'
import assert from 'node:assert/strict'
import { multiplyMatrix4 } from '../../../../sdk-core/src/index.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { fieldCamera } from '../../gpu/dag/placementTree.fixture.ts'

const f = Math.fround

/** `m · v` in single, each product and sum rounded, `m` column-major and already single. */
function mulSingle(m: ArrayLike<number>, v: readonly number[]) {
  return [0, 1, 2, 3].map((row) => {
    let sum = 0
    for (let col = 0; col < 4; col++) sum = f(sum + f(m[col * 4 + row] * v[col]))
    return sum
  })
}

/** ULPs of single between `a` and `b`, at `b`. */
const ulps = (a: number, b: number) =>
  Math.abs(a - b) / 2 ** (Math.floor(Math.log2(Math.abs(b))) - 23)

test('a card at the eye keeps its depth within three ULP of the double, to 10⁵ m', () => {
  let seed = 3
  const next = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
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
    const point = [3 * (next() - 0.5), 3 * next(), 3 * (next() - 0.5), 1].map(f)
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
    const relative = [0, 1, 2].map((k) => {
      const high = f(world[12 + k]),
        low = f(world[12 + k] - high),
        eyeHigh = f(eye[k]),
        eyeLow = f(eye[k] - eyeHigh)
      const linear = f(
        f(f(f(world[k]) * point[0]) + f(f(world[4 + k]) * point[1])) +
          f(f(world[8 + k]) * point[2]),
      )
      return f(linear + f(f(high - eyeHigh) + f(low - eyeLow)))
    })
    const now = mulSingle(Float32Array.from(at), [...relative, 1])
    const depth = exact[2] / exact[3]
    before = Math.max(before, ulps(f(old[2] / old[3]), depth))
    after = Math.max(after, ulps(f(now[2] / now[3]), depth))
  }
  console.log(`depth error: ${after.toFixed(2)} ULP at the eye, ${before.toFixed(2)} composed`)
  assert.ok(after <= 3 && before <= 2, `${after} ULP at the eye, ${before} composed`)
})
