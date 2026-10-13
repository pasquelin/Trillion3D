// A mirror sphere over a dark floor under a sky shows the floor's reflection without a staircase
// (`sphereStaircasePage.ts`, `sphereFrame.ts`): along the reflected horizon and below it the image
// is continuous at the pixel. The analytic image is each sphere pixel's exact mirror ray, the
// floor's colour where it meets the floor the screen answers whole (inside the image's border,
// within half of the march's reach), the sky's where it meets nothing; between two neighbouring
// pixels the engine's image may step by what the analytic image steps within a pixel of them (its
// hard horizon) and by ε more.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/sphere-staircase.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { fromHalf } from '../../../packages/math/src/float/half.ts'
import { REFLECTION_CONSTANTS } from '../../../packages/sdk-browser/src/reflections/constants.ts'
import { exactReflection, SPHERES, sphereFrame } from './sphereFrame.ts'

const EDGE = REFLECTION_CONSTANTS.REFLECTION_EDGE,
  STEP_CAP = REFLECTION_CONSTANTS.REFLECTION_STEP_CAP

/** The step ε two neighbours may take beyond the analytic one, a share of the sky's radiance over
 *  the floor's: the shipped march gives 0.03 (a pixel's reflected footprint a tap or two wide); a
 *  coarse cell of the Hi-Z that loses the far half of a grazing pixel's plane gives 0.995, a pixel
 *  of sky in the floor's reflection, in arcs along the cells' rows. */
const EPSILON = 0.05

/** The cosine of the angle between a sphere's normal and the eye under which a pixel is judged: the
 *  rim beyond (a tenth of the sphere's radius deep, `0.3`) turns the reflected direction faster than
 *  the pixel grid, and the floor point the ray reaches several pixels of the image from one pixel
 *  to the next. */
const FACING = 0.3

test('the floor reflected in a mirror sphere has no pixel-to-pixel step the analytic image lacks', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'sphereStaircasePage.ts'),
    'reflectionSphereStaircase',
  )) as typeof import('./sphereStaircasePage.ts')
  const result = await runOnDawn(page.run, undefined)
  assert.equal(result.error, undefined, result.error)
  assert.deepEqual(result.errors, [])
  const { width, height, floor, sky } = SPHERES
  const { view, shown } = sphereFrame()
  // Whether the floor shows at the pixel of the world point `at` and all around it: the screen sees
  // it (a point behind a sphere, or at a silhouette, is not in the depth the march reads).
  const floorSeen = (at: number[], from: number) => {
    const [hx, hy] = view.project(at as [number, number, number])
    // Inside the image's border, and within half of the march's reach of the pixel: the screen's
    // answer there is whole, its fades (`reflectionSeen`) are one.
    const border = EDGE * height
    if (hx <= border || hy <= border || hx >= width - border || hy >= height - border) return false
    const away = Math.abs(hx - (from % width) - 0.5) + Math.abs(hy - Math.floor(from / width) - 0.5)
    if (away >= STEP_CAP / 2) return false
    for (let v = -2; v <= 2; v++)
      for (let u = -2; u <= 2; u++) {
        const px = Math.floor(hx) + u,
          py = Math.floor(hy) + v
        if (px < 0 || py < 0 || px >= width || py >= height) return false
        if (shown[py * width + px] !== -2) return false
      }
    return true
  }
  const range = sky - floor
  const seen = (p: number) => fromHalf(result.words![p * 4])
  // The analytic radiance of a sphere pixel: the floor's where its ray meets a floor the screen
  // sees, the sky's where it meets nothing; NaN elsewhere (a sphere's, which the screen answers
  // with the sphere's, or a floor the screen cannot see).
  const analytic = new Float64Array(width * height).fill(NaN)
  let floored = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const exact = exactReflection(view, x + 0.5, y + 0.5)
      if (!exact || exact.facing < FACING) continue
      if (exact.index === -2 && floorSeen(exact.at, y * width + x)) {
        analytic[y * width + x] = floor
        floored++
      } else if (exact.index === -1) analytic[y * width + x] = sky
    }
  assert.ok(floored > 4000, `${floored} sphere pixels reflect the floor`)
  // The analytic step an edge may take at the pair `p, q`: the largest between neighbours within
  // a pixel of it — the engine's edge sits where the exact one does to the pixel.
  const allowed = (p: number, q: number) => {
    let most = 0
    for (const c of [p, q]) {
      const cx = c % width,
        cy = Math.floor(c / width)
      for (let v = -1; v <= 1; v++)
        for (let u = -1; u <= 1; u++) {
          const a = (cy + v) * width + cx + u
          for (const b of [a + 1, a + width]) {
            if (a < 0 || b >= width * height) continue
            const step = Math.abs(analytic[a] - analytic[b]) / range
            if (step > most) most = step
          }
        }
    }
    return most
  }
  let worst = 0,
    pairs = 0,
    at = ''
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (Number.isNaN(analytic[p])) continue
      for (const q of [p + 1, p + width]) {
        if ((q === p + 1 && x + 1 >= width) || q >= width * height || Number.isNaN(analytic[q]))
          continue
        const excess = Math.abs(seen(p) - seen(q)) / range - allowed(p, q)
        pairs++
        if (excess > worst) {
          worst = excess
          at = `${x},${y}`
        }
      }
    }
  console.log(JSON.stringify({ pairs, worst, at }))
  assert.ok(pairs > 8000, `${pairs} neighbouring pairs`)
  assert.ok(
    worst <= EPSILON,
    `a step of ${worst} beyond the analytic one at ${at}, over ${EPSILON}`,
  )
})
