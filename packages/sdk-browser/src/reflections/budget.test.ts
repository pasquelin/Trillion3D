// The march's iterations are bounded by the screen distance the ray covers, `K(M) = 4M + 6ℓ + 1`
// for `M` pixels of L1 length (at most `REFLECTION_STEP_CAP`) and `ℓ` levels, on every ray, never
// out of the iterations it is given: 10⁵ mirror rays of generated floors seen at 0.5° to 89° from
// their plane, flat and under waves, before a wall, the shipped WGSL run as JavaScript
// (`scene.fixture.ts`). The mean and the 99th percentile of the iterations are published.
import test from 'node:test'
import assert from 'node:assert/strict'
import { lcgRandom } from '../../../math/src/sequence/random.ts'
import { reflectionRunner, sceneFromDepth } from './scene.fixture.ts'
import { camera, type V3 } from './boxes.fixture.ts'

const RAYS = 100_000
const SCENES = 40
const WIDTH = 320,
  HEIGHT = 180

/** The height of the water at `(x, z)`: two crossing swells, the second steeper. */
const wave = (amplitude: number, x: number, z: number) =>
  amplitude * (Math.sin(0.9 * x + 0.3 * z) + 0.6 * Math.sin(2.1 * z - 1.3 * x))

/** The first `t` at which the ray `o + d·t` is under the surface `y = height(x, z)`, found by a
 *  march of steps shrinking toward the horizon and bisected, or Infinity. */
function castHeightfield(o: V3, d: V3, height: (x: number, z: number) => number) {
  let previous = 0
  for (let t = 0.02; t < 400; t *= 1.01) {
    const y = o[1] + d[1] * t - height(o[0] + d[0] * t, o[2] + d[2] * t)
    if (y <= 0) {
      let lo = previous,
        hi = t
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2
        const under = o[1] + d[1] * mid - height(o[0] + d[0] * mid, o[2] + d[2] * mid) <= 0
        if (under) hi = mid
        else lo = mid
      }
      return hi
    }
    previous = t
  }
  return Infinity
}

test('every ray of floors and waves stays within K(M) iterations and none runs out', () => {
  const rand = lcgRandom(1521)
  const iterations: number[] = []
  let outOfBound = 0
  for (let scene = 0; scene < SCENES; scene++) {
    // Pitch of the view below the floor's plane: 0.5° to 89°, geometrically spaced, flat floors
    // and waves in turn.
    const pitch = (0.5 * (89 / 0.5) ** ((scene >> 1) / (SCENES / 2 - 1)) * Math.PI) / 180
    const amplitude = scene % 2 ? 0 : 0.05 + 0.1 * rand()
    const height = (x: number, z: number) => wave(amplitude, x, z)
    const eye: V3 = [0, 3, 0]
    const view = camera(
      eye,
      [0, eye[1] - Math.sin(pitch), -Math.cos(pitch)],
      WIDTH,
      HEIGHT,
      Math.PI / 3,
    )
    const wallDistance = 12 + 30 * rand()
    const depth = new Float64Array(WIDTH * HEIGHT)
    const surfaces: (V3 | undefined)[] = []
    for (let y = 0; y < HEIGHT; y++)
      for (let x = 0; x < WIDTH; x++) {
        const d = view.ray(x + 0.5, y + 0.5)
        const floor = castHeightfield(eye, d, height)
        const wall = d[2] < 0 ? wallDistance / -d[2] : Infinity
        const t = Math.min(floor, wall)
        const forward = d[0] * view.forward[0] + d[1] * view.forward[1] + d[2] * view.forward[2]
        depth[y * WIDTH + x] = Number.isFinite(t) ? view.near / (t * forward) : 0
        surfaces.push(t === floor ? ([0, 1, 2].map((k) => eye[k] + d[k] * t) as V3) : undefined)
      }
    const run = reflectionRunner(...sceneFromDepth(view, depth))
    for (let k = 0; k < RAYS / SCENES; k++) {
      let P: V3 | undefined
      while (!P) P = surfaces[Math.floor(rand() * WIDTH * HEIGHT)]
      // The surface's normal, from its slopes.
      const e = 1e-3
      const slope = [
        (height(P[0] + e, P[2]) - height(P[0] - e, P[2])) / (2 * e),
        (height(P[0], P[2] + e) - height(P[0], P[2] - e)) / (2 * e),
      ]
      const length = Math.hypot(slope[0], 1, slope[1])
      const N: V3 = [-slope[0] / length, 1 / length, -slope[1] / length]
      const toEye = [0, 1, 2].map((a) => eye[a] - P![a]) as V3
      const away = Math.hypot(...toEye)
      const V: V3 = [toEye[0] / away, toEye[1] / away, toEye[2] / away]
      const cosine = V[0] * N[0] + V[1] * N[1] + V[2] * N[2]
      if (cosine <= 0) continue
      const R = [0, 1, 2].map((a) => 2 * cosine * N[a] - V[a]) as V3
      const alpha = 0.0028
      const ray = run.reflectionRay(P, N, run.reflectionLobeOf(R, alpha, [0, 0, 0, alpha]))
      run.counter.loads = 0
      const hit = run.screenMarch(ray.o, ray.d, ray.end, run.thickness, run.slab)
      const bound = run.screenMarchBudget(ray.d, ray.end, run.levels)
      const reads = run.counter.loads
      assert.ok(reads <= bound, `scene ${scene}, ray ${k}: ${reads} reads of ${bound}`)
      if (hit.t < 0 && reads === bound) outOfBound++
      iterations.push(reads)
    }
  }
  iterations.sort((a, b) => a - b)
  const mean = iterations.reduce((sum, count) => sum + count, 0) / iterations.length
  const p99 = iterations[Math.floor(iterations.length * 0.99)]
  console.log(JSON.stringify({ rays: iterations.length, meanIterations: mean, p99Iterations: p99 }))
  assert.equal(outOfBound, 0, 'no ray ran out of its iterations')
  assert.ok(iterations.length > 0.9 * RAYS, `${iterations.length} rays measured`)
})
