// The projection's screen ray (`vsmScreenRayCast`) is the engine's screen march (`screenMarch`,
// `gpu/hiz/screenMarch.ts`) of the depth pyramid, shipped WGSL run as JavaScript over a depth image
// seen by an orthographic view whose world is its NDC: a wall one pixel wide in the ray is met at
// every sub-pixel offset of the ray and in every direction, a surface the ray stays in front of
// is none, a surface nearer than the ray by more than its own depth span is no occluder, and the
// reads it takes grow with the logarithm of the ray's length in pixels — never with it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun, Mat } from '../texture/shaderRun.fixture.ts'
import { screenSlab } from '../gpu/hiz/screenSlab.ts'
import {
  depthField,
  depthImage,
  depthLoads,
  HIZ_DEPTH_READERS,
} from '../reflections/depthField.fixture.ts'
import { CODE, constructors } from './pageWorld.fixture.ts'

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** The shipped cast over the depth image `depth`, `width × height`, in a view whose NDC is its
 *  world; it counts the cells of the pyramid it reads. */
function caster(width: number, height: number, depth: (x: number, y: number) => number) {
  const field = depthField(width, height, depthImage(width, height, depth))
  const token = { depth: {}, pyramid: {}, front: {} }
  const counter = { loads: 0 }
  const run = shaderRun<{
    vsmScreenRayCast: (o: number[], d: number[], length: number, thickness: number) => number
  }>(
    CODE,
    [
      'vsmScreenRayCast',
      'screenMarch',
      'screenMarchEnd',
      'screenMarchBudget',
      'screenBack',
      'clipToFramebuffer',
      'perspectiveDivide',
      ...HIZ_DEPTH_READERS,
    ],
    {
      vsmView: {
        shiftedToClip: new Mat(IDENTITY),
        viewPixels: [width, height, 1 / width, 1 / height],
        screenSlab: screenSlab(IDENTITY, height),
      },
      hizDepth: token.depth,
      hizPyramid: token.pyramid,
      hizFront: token.front,
      hizLevels: field.levels,
      ...constructors(CODE),
      textureLoad: depthLoads(field, token, () => counter.loads++),
    },
  )
  return { cast: run.vsmScreenRayCast, counter }
}

const W = 128,
  H = 64
/** The NDC of the centre of pixel `(x, y)`. */
const ndc = (x: number, y: number) => [((x + 0.5) / W) * 2 - 1, 1 - ((y + 0.5) / H) * 2]
/** Thickness a ray of 16 pixels gives its slab, in pixels of footprint. */
const SPAN = 16

test('a wall one pixel wide in the ray is met at every sub-pixel offset and in every direction', () => {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -0.37],
    [-0.61, -1],
  ]) {
    const length = 16 / Math.max(Math.abs(dx), Math.abs(dy))
    for (const share of [0.15, 0.4, 0.62, 0.9]) {
      for (let k = 0; k <= 8; k++) {
        // The ray from near pixel (64, 32)'s centre, `length` pixels along its longer axis; the wall
        // the one pixel its path crosses at `share` of it, under the ray's depth (reversed: nearer).
        const jitter = (k / 8 - 0.5) * 0.9
        const x0 = 64.5 + jitter,
          y0 = 32.5 - jitter * 0.7
        const wx = Math.floor(x0 + dx * length * share),
          wy = Math.floor(y0 + dy * length * share)
        const { cast } = caster(W, H, (x, y) => (x === wx && y === wy ? 0.6 : 0.1))
        const o = ndc(x0 - 0.5, y0 - 0.5)
        // In NDC: x spans 2 / W a pixel, y 2 / H; the ray's depth falls from 0.5 to 0.4.
        const d = [(dx * length * 2) / W, (-dy * length * 2) / H, -0.1]
        const got = cast([o[0], o[1], 0.5], d, 1, SPAN)
        assert.ok(
          got < 1,
          `direction ${dx},${dy}: the wall at ${share} is stepped over at ${jitter}`,
        )
      }
    }
  }
})

test('a ray in front of everything meets nothing, in a few reads that grow with the log of its length', () => {
  const reads = (pixels: number) => {
    const { cast, counter } = caster(1024, 64, () => 0.1)
    const o = ndc(100, 32)
    const got = cast([o[0], o[1], 0.5], [(pixels * 2) / 1024, 0, 0], 1, SPAN)
    assert.equal(got, 1, `${pixels} pixels: met nothing`)
    return counter.loads
  }
  const [r16, r64, r256, r768] = [16, 64, 256, 768].map(reads)
  console.log(JSON.stringify({ r16, r64, r256, r768 }))
  // Four times the length takes a level or two more, never four times the reads.
  assert.ok(r256 - r16 <= 2 * 4 + 2, `${r16} reads at 16 pixels, ${r256} at 256`)
  assert.ok(r768 <= 2 * (Math.log2(768) + 2), `${r768} reads at 768 pixels`)
})

test('a surface nearer than the ray by more than the ray spans is no occluder, one within it is', () => {
  // A wall of the width of the image at x = 80, under the ray's depth (0.5 → 0.4) by `margin`.
  const hit = (margin: number) => {
    const { cast } = caster(W, H, (x) => (x >= 80 ? 0.5 + margin : 0.1))
    const o = ndc(64, 32)
    return cast([o[0], o[1], 0.5], [(32 * 2) / W, 0, -0.1], 1, SPAN) < 1
  }
  // A thickness of `SPAN` pixels in this view is SPAN · 2 / H of depth: 0.5.
  assert.ok(hit(0.3), 'a wall 0.3 nearer, inside the span')
  assert.ok(!hit(0.9), 'a wall 0.9 nearer, outside it')
})

test('the occluder is placed a pixel and a half back along the ray, never before its start', () => {
  const { cast } = caster(W, H, (x) => (x >= 80 ? 0.6 : 0.1))
  const o = ndc(64, 32)
  const length = 32
  const got = cast([o[0], o[1], 0.5], [(length * 2) / W, 0, -0.1], 1, SPAN)
  // The ray enters pixel 80 at 16 pixels of its 32 (x = 80.0 from 64.5 centre: 15.5 pixels in);
  // the wall's plane is at 0.6, above the ray's depth the whole way: it hits where it enters.
  const entry = (80 - 64.5) / length
  assert.ok(Math.abs(got - (entry - 1.5 / length)) < 1e-3, `${got} against ${entry - 1.5 / length}`)
  // A wall at the very first pixel the ray leaves is at 0, never negative.
  const first = caster(W, H, (x) => (x >= 65 ? 0.6 : 0.1)).cast(
    [o[0], o[1], 0.5],
    [(length * 2) / W, 0, -0.1],
    1,
    SPAN,
  )
  assert.equal(first, 0)
})
