// The screen walk every mirror and rough ray takes (`screenReflection`): a pixel answers where
// the ray crosses its own surface, and the depth pyramid passes whole only a cell whose range the
// ray cannot meet, so the walk over the pyramid answers the pixel the walk pixel by pixel answers.
// The shipped walk runs in JavaScript (`shaderRun`) on generated depth images, over the pyramid the
// shipped reductions build (`boundsPyramidWgsl.ts`, read by `reflectionBoundsAt`), and with no
// level above the pixels, where it steps pixel by pixel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { random } from '../page/cut/cutRuleChecks.fixture.ts'
import { SCREEN_TRACE_WGSL } from './traceShader.ts'
import { REFLECTION_CONE_WGSL } from './coneWgsl.ts'
import { REFLECTION_BOUNDS_DEPTH_WGSL, REFLECTION_BOUNDS_LEVEL_WGSL } from './boundsPyramidWgsl.ts'
import { TAU } from '../../../math/src/constants.ts'

/** Sizes whose every level halves evenly, as the reductions' integer halving runs here in doubles. */
const W = 32,
  H = 16
/** A pixel's surface: what the bounds and the walk both read. */
const PLANE = [
  'reflectionDepthOrClear',
  'reflectionContinues',
  'reflectionSideSlope',
  'reflectionHalves',
  'reflectionAround',
  'reflectionSurface',
  'reflectionPixelBounds',
]
type Level = { w: number; h: number; data: number[][] }
type Walk = (start: number[], delta: number[], za: number, zb: number, size: number[]) => number[]

/** The bounds pyramid of `depth` as the shipped reductions build it, level 0 at half its size. */
function boundsOf(depth: Float64Array) {
  const reduce = (source: string, names: string[], scope: object) =>
    shaderRun<{ cellReduction: (pixel: number[]) => number[] }>(
      source,
      ['cellReduction', 'mipRead', ...names],
      scope,
    ).cellReduction
  const levels: Level[] = []
  let read = reduce(
    REFLECTION_BOUNDS_DEPTH_WGSL,
    [...PLANE, 'reflectionDepthAt', 'reflectionSize'],
    {
      source: 'depth',
      extent: [W, H, W, H],
      textureLoad: (_: unknown, p: number[]) => depth[p[1] * W + p[0]],
    },
  )
  for (let [w, h] = [W / 2, H / 2]; ; [w, h] = [Math.max(1, w >> 1), Math.max(1, h >> 1)]) {
    const data: number[][] = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.push(read([x, y]))
    const level = { w, h, data }
    levels.push(level)
    if (w === 1 && h === 1) return levels
    read = reduce(REFLECTION_BOUNDS_LEVEL_WGSL, [], {
      source: level,
      extent: [w, h, W, H],
      textureLoad: (from: Level, p: number[]) => from.data[p[1] * from.w + p[0]],
    })
  }
}

/** The shipped walk over `depth`, with `levels` of the pyramid above the pixels (none: pixel by
 *  pixel). A hit answers its pixel. */
function walkOf(depth: Float64Array, levels: Level[]) {
  return shaderRun<{ reflectionHiZWalk: Walk }>(
    SCREEN_TRACE_WGSL + REFLECTION_CONE_WGSL,
    [
      'reflectionHiZWalk',
      'reflectionHiZSteps',
      'reflectionOnSurface',
      'reflectionBoundsAt',
      'reflectionBoundsLevels',
      ...PLANE,
    ],
    {
      reflectionDepthAt: (p: number[]) => depth[p[1] * W + p[0]],
      reflectionSize: () => [W, H],
      reflectionHitAt: (p: number[]) => [p[0], p[1], 0, 1],
      reflectionBounds: 'bounds',
      textureNumLevels: () => levels.length,
      textureDimensions: (_: unknown, level: number) => [levels[level].w, levels[level].h],
      textureLoad: (_: unknown, p: number[], level: number) =>
        levels[level].data[p[1] * levels[level].w + p[0]],
    },
  ).reflectionHiZWalk
}

/** A floor rising toward the top of the image, sky above it, and boxes standing on it — flat,
 *  sloped or thin —; `noise` scatters single pixels in front of and behind it. Reversed depth: zero
 *  is the clear depth, nearer is greater. */
function scene(next: () => number, noise: boolean) {
  const depth = new Float64Array(W * H)
  const horizon = 2 + Math.floor(next() * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) depth[y * W + x] = y < horizon ? 0 : 0.05 + 0.03 * (y - horizon)
  for (let box = 0; box < 4; box++) {
    const [x0, y0] = [Math.floor(next() * W), horizon + Math.floor(next() * (H - horizon))]
    const [w, h] = [1 + Math.floor(next() * 8), 1 + Math.floor(next() * 6)]
    const [front, slope] = [next() * 0.3, (next() - 0.5) * 0.04]
    for (let y = Math.max(0, y0 - h); y < y0; y++)
      for (let x = x0; x < Math.min(W, x0 + w); x++)
        depth[y * W + x] = Math.max(depth[y * W + x], depth[y0 * W + x] + front + slope * (x - x0))
  }
  if (noise) for (let i = 0; i < W * H; i++) if (next() < 0.08) depth[i] = next() < 0.2 ? 0 : next()
  return depth
}

test('the walk over the depth pyramid answers the pixel the pixel walk answers', () => {
  const next = random(831)
  let rays = 0,
    hits = 0,
    long = 0
  for (let image = 0; image < 24; image++) {
    const depth = scene(next, image % 3 === 2)
    const pyramid = walkOf(depth, boundsOf(depth)),
      pixels = walkOf(depth, [])
    for (let ray = 0; ray < 60; ray++) {
      const start = [next() * W, next() * H]
      const angle = next() * TAU,
        length = 1 + next() * 48
      const delta = [Math.cos(angle) * length, Math.sin(angle) * length]
      // From just before the receiver's own depth, mostly away from the eye — into the scene —,
      // else toward it.
      const at = depth[Math.floor(start[1]) * W + Math.floor(start[0])]
      const za = at + next() * 0.02,
        zb = next() < 0.8 ? next() * za : za + next() * 0.3
      const expected = pixels(start, delta, za, zb, [W, H])
      assert.deepEqual(
        pyramid(start, delta, za, zb, [W, H]),
        expected,
        `image ${image}, ray ${ray}: from ${start} by ${delta}, depth ${za} to ${zb}`,
      )
      rays++
      hits += expected[3]
      long += +(length > 16)
    }
  }
  // Enough of each to say something: hits and misses, rays that cross coarse cells.
  assert.ok(hits > rays / 8 && hits < rays * 0.9, `${hits} hits of ${rays} rays`)
  assert.ok(long > rays / 3, `${long} long rays`)
})
