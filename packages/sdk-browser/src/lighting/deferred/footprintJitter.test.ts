// A pixel's footprint, from the shipped `pixelFootprint` run through `shaderRun` over a floor
// the camera looks down at, rasterized at each phase of the TAA's jitter cycle: the level of every
// floor pixel's footprint (its log2, floored) is the same at every phase — where a
// footprint taken at the jittered sample moves some of them —, and with no jitter the footprint is
// that sample's, to the bit. So on a strip of that floor one pixel wide, background on both sides,
// as a wire, a bar or a far thin part: its levels hold every phase too.
import test from 'node:test'
import assert from 'node:assert/strict'
import { invertMatrix4, multiplyMatrix4 } from '../../../../sdk-core/src/index.ts'
import { perspectiveProjection } from '../../../../math/src/projection/camera.ts'
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts'
import { TAA_SAMPLES, jitterViewProjection, taaJitter } from '../../taa/jitter.ts'
import { PIXEL_FOOTPRINT_WGSL } from './footprintWgsl.ts'
import { shadowJitterWords } from './jitterWords.ts'
import { DEG2RAD } from '../../../../math/src/constants.ts'
import { lerp } from '../../../../math/src/scalar/reals.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

type V = number[]
const W = 64,
  H = 48,
  FINEST = -40
/** The view and depth buffer the shipped functions read: rewritten per phase. */
const live = {
  view: { inverseViewProjection: new Mat([]), viewport: [W, H, 0, 0], jitter: [0, 0, 1, 0] },
  depth: new Float64Array(W * H),
}
const run = shaderRun<{
  pixelFootprint: (coord: V, pixel: V, z: number, P: V) => number
  worldAt: (pixel: V, z: number) => V
}>(
  wgslModule(PIXEL_FOOTPRINT_WGSL),
  [
    'pixelFootprint',
    'unjitteredDepth',
    'surfaceSlope',
    'footprintDepth',
    'worldAt',
    'pixelToNdc',
    'unprojectPoint',
    'perspectiveDivide',
    'transformHomogeneousPoint',
  ],
  {
    view: live.view,
    depth: null,
    textureLoad: (_: unknown, [x, y]: V) => live.depth[y * W + x],
  },
)

/** A camera two metres up, pitched 25° down, a 60° field: its view-projection. */
function cameraViewProjection() {
  const pitch = 25 * DEG2RAD,
    s = Math.sin(pitch),
    c = Math.cos(pitch)
  const world = new Float64Array([1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 2, 0, 1])
  const view = invertMatrix4(new Float64Array(16), world),
    projection = perspectiveProjection(new Float64Array(16), 60, W / H, 0.1, 1)
  return multiplyMatrix4(new Float64Array(16), projection, view)
}
const VIEW_PROJECTION = cameraViewProjection()

/** Whether the floor holds the point `hit`: all of it, or on `thin`, the strip of it the unjittered
 *  view shows in the image's column 32 alone — a wedge on the floor, background on both sides. */
const onFloor = (hit: V, thin: boolean) => {
  if (!thin) return true
  const clip = [0, 3].map((r) =>
    [0, 1, 2].reduce(
      (sum, i) => sum + VIEW_PROJECTION[i * 4 + r] * hit[i],
      VIEW_PROJECTION[12 + r],
    ),
  )
  const column = ((clip[0] / clip[1] + 1) / 2) * W
  return column >= 32 && column < 33
}

/** The image of phase `sample`: its view, and the depth of the floor `y = 0` — or of its `thin`
 *  strip — at each pixel's jittered sample, 0 — the far clear — where the ray misses it. */
function phase(sample: number, thin = false) {
  const jitter = taaJitter(sample, new Float64Array(2))
  const vp = jitterViewProjection(new Float64Array(16), VIEW_PROJECTION, jitter[0], jitter[1], W, H)
  live.view.inverseViewProjection = new Mat([...invertMatrix4(new Float64Array(16), vp)])
  live.view.jitter = shadowJitterWords(jitter)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const near = run.worldAt([x + 0.5, y + 0.5], 1),
        far = run.worldAt([x + 0.5, y + 0.5], 0.5)
      const t = near[1] / (near[1] - far[1])
      const hit = near.map((n, i) => lerp(n, far[i], t))
      const clip = [0, 1, 2, 3].map((r) =>
        [0, 1, 2].reduce((sum, i) => sum + vp[i * 4 + r] * hit[i], vp[12 + r]),
      )
      live.depth[y * W + x] = t > 0 && onFloor(hit, thin) ? clip[2] / clip[3] : 0
    }
}

/** The level of a footprint: its log2 floored, never finer than `FINEST`. */
const levelOf = (footprint: number) =>
  Math.max(Math.trunc(Math.floor(Math.log2(Math.max(footprint, 1e-30)))), FINEST)

/** Every floor pixel whose two neighbours above and below are floor too — and on the whole floor,
 *  its two on each side —, at every phase: its levels, the shipped read's and the jittered read's,
 *  one row per phase. */
function levelsAcrossPhases(thin = false) {
  const shipped = new Map<number, string[]>(),
    developed = new Map<number, string[]>(),
    floor = new Set<number>()
  for (let sample = 0; sample < TAA_SAMPLES; sample++) {
    phase(sample, thin)
    for (let y = 2; y < H - 2; y++)
      for (let x = 2; x < W - 2; x++) {
        const i = y * W + x,
          around = thin ? [-2 * W, -W, W, 2 * W] : [-2, -1, 1, 2, -2 * W, -W, W, 2 * W]
        const z = live.depth[i]
        if ([z, ...around.map((d) => live.depth[i + d])].some((d) => d <= 0)) {
          floor.delete(i)
          continue
        }
        if (sample === 0) floor.add(i)
        const P = run.worldAt([x + 0.5, y + 0.5], z)
        const shippedFootprint = run.pixelFootprint([x, y], [x + 0.5, y + 0.5], z, P)
        const footprint = Math.hypot(...run.worldAt([x + 1.5, y + 0.5], z).map((v, k) => v - P[k]))
        shipped.set(i, [...(shipped.get(i) ?? []), `${levelOf(shippedFootprint)}`])
        developed.set(i, [...(developed.get(i) ?? []), `${levelOf(footprint)}`])
      }
  }
  return { floor: [...floor], shipped, developed }
}

test('the footprint level of a pixel is the same at every phase of the TAA jitter', () => {
  const { floor, shipped, developed } = levelsAcrossPhases()
  assert.ok(floor.length > W * 10, 'the floor fills rows of the image')
  const moved = (reads: Map<number, string[]>) =>
    floor.filter((i) => new Set(reads.get(i)).size > 1)
  assert.deepEqual(moved(shipped), [], 'no floor pixel changes its footprint level')
  // The floor crosses several levels: the jittered read moves pixels along them.
  assert.ok(new Set(floor.map((i) => shipped.get(i)![0])).size >= 4, 'several levels on the floor')
  assert.ok(moved(developed).length > 0, 'develop moves pixels along the level boundaries')
})

test('on a strip one pixel wide, background on both sides, the level is the same at every phase', () => {
  const { floor, shipped } = levelsAcrossPhases(true)
  assert.ok(floor.length > H / 2, 'the strip runs down the image')
  assert.ok(
    floor.every((i) => i % W === 32),
    'the strip is one pixel wide',
  )
  const moved = floor.filter((i) => new Set(shipped.get(i)).size > 1)
  assert.deepEqual(moved, [], 'no strip pixel changes its footprint level')
  assert.ok(new Set(floor.map((i) => shipped.get(i)![0])).size >= 3, 'several levels on the strip')
})

test('with no jitter, the footprint is develop’s, to the bit', () => {
  phase(0)
  live.view.jitter = shadowJitterWords(null)
  for (let i = W * 20; i < W * 21; i++) {
    const x = i % W,
      y = Math.floor(i / W),
      z = live.depth[i]
    const P = run.worldAt([x + 0.5, y + 0.5], z)
    const footprint = Math.hypot(...run.worldAt([x + 1.5, y + 0.5], z).map((v, k) => v - P[k]))
    assert.equal(run.pixelFootprint([x, y], [x + 0.5, y + 0.5], z, P), footprint)
  }
})
