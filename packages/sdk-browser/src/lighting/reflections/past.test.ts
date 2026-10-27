// Where a screen hit stood in the last image (`reflectionPast`) and whether that image showed it there (`reflectionPastAgrees`), run in
// JavaScript by `shaderRun`: a still surface where the last view-projection puts it, a surface that moves by itself where its vector says it
// stood and at the depth its depth step says, neither image's jitter read as a motion; the depth the last image kept against the depth the hit
// is expected at, within a thickness dithered by the pixel's vote.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { VECTOR_CODEC_WGSL } from '../../post/taa/velocityWgsl.ts'
import { reflectionPastWgsl } from './past.ts'

type Vec2 = [number, number]
type Past = { pixel: Vec2; z: number; valid: boolean }

const SIZE: Vec2 = [64, 32]
const codec = shaderRun<{
  encodeOwnVector: (v: Vec2, own: boolean) => number
  withDepthStep: (word: number, step: number) => number
}>(VECTOR_CODEC_WGSL, ['encodeOwnVector', 'withDepthStep'], {})

/** The texture the last image's depth is read from, as the shipped functions name it. */
const history = {}

/** A perspective looking down +z from the origin: a point's clip `w` is its depth. */
const viewProj = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0])

/** The shipped functions over a vector texel `texel` of the pixel the hit lands on, the depth the last image kept `kept`, the jitters
 *  `jitter` (this image's, then the last's) and the opaque depth of this image `current`. */
function past(texel: number[], jitter = [0, 0, 0, 0], kept = 0.25, current = 0.75, tracedKept = 1) {
  return shaderRun<{
    reflectionPast: (hit: number[], S: Vec2, z: number) => Past
    reflectionPastTexel: (past: Past) => Vec2
    reflectionPastAgrees: (past: Past, noise: number, thickness: number) => boolean
  }>(
    wgslModule(reflectionPastWgsl(1)),
    ['reflectionPast', 'reflectionPastTexel', 'reflectionPastAgrees'],
    {
      reflectionView: {
        radianceViewProj: viewProj,
        radiance: [SIZE[0], SIZE[1], 0, 1],
        jitter,
        traced: [1, tracedKept, 0, 0],
      },
      view: { viewport: [SIZE[0], SIZE[1], 0, 0] },
      temporalVectors: {},
      reflectionDepthHistory: history,
      textureDimensions: () => SIZE,
      textureLoad: (t: object) => (t === history ? [kept, 0, 0, 0] : texel),
      hizOpaqueDepth: () => current,
    },
  )
}
const near = (a: readonly number[], b: readonly number[], what: string) =>
  a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < 5e-3, `${what}: ${a} against ${b}`))

// A hit at (1, 0.5, 2): the last view-projection puts it at the device position (0.5, 0.25), depth 1.
const hit = [1, 0.5, 2]
const S: Vec2 = [48.2, 11.9]

test('a still surface stood where the last view-projection puts its point, at its clip depth', () => {
  const result = past([0, 0, 0, 0]).reflectionPast(hit, S, 0.4)
  near(result.pixel, [48, 12], 'the pixel of (0.5, 0.25) in 64 × 32')
  near([result.z], [1], 'clip depth')
  assert.equal(result.valid, true)
  // Behind the last camera, a still surface stood nowhere.
  assert.equal(past([0, 0, 0, 0]).reflectionPast([1, 0.5, -2], S, 0.4).valid, false)
})

test('a surface that moves by itself stood where its vector says, at the depth its step says; the jitters of both images are no motion', () => {
  const moving: Vec2 = [0.125, -0.0625]
  const word = codec.encodeOwnVector(moving, true)
  const flags = codec.withDepthStep(0, 0.125)
  const here: Vec2 = [(S[0] / SIZE[0]) * 2 - 1, 1 - (S[1] / SIZE[1]) * 2]
  const expectedPixel = (shift: Vec2): Vec2 => [
    ((here[0] - moving[0] + shift[0]) * 0.5 + 0.5) * SIZE[0],
    (0.5 - (here[1] - moving[1] + shift[1]) * 0.5) * SIZE[1],
  ]
  const result = past([word, flags, 0, 0]).reflectionPast(hit, S, 0.4)
  near(result.pixel, expectedPixel([0, 0]), 'stood')
  near([result.z], [0.4 - 0.125], 'the depth less its step')
  assert.equal(result.valid, true)
  // This image's jitter is taken off the position the vector is read from, the last image's put back on the position it names.
  const jittered = past([word, flags, 0, 0], [0.02, -0.01, 0.03, 0.04]).reflectionPast(hit, S, 0.4)
  const withJitter = expectedPixel([0.03 - 0.02, 0.04 + 0.01])
  near(jittered.pixel, withJitter, 'jittered')
  // Even behind the last camera, a surface that moves by itself stood where its vector says.
  assert.equal(past([word, flags, 0, 0]).reflectionPast([1, 0.5, -2], S, 0.4).valid, true)
})

test('the texel of the last image is held within it, half a texel from its edge', () => {
  const run = past([0, 0, 0, 0])
  const edge = (pixel: Vec2) =>
    run.reflectionPastTexel({ pixel, z: 0, valid: true }) as unknown as number[]
  assert.deepEqual(edge([-5, 100]), [0, 31])
  assert.deepEqual(edge([70, -2]), [63, 0])
  assert.deepEqual(edge([10.7, 3.2]), [10, 3])
})

test('a hit stands where the depth the last image kept lies from the expected depth by less than the thickness dithered from half to twice by the vote', () => {
  const place = (z: number): Past => ({ pixel: [10, 10], z, valid: true })
  // The last image kept 0.25 there; the thickness 0.01.
  const agrees = (z: number, noise: number, tracedKept = 1, current = 0.75) =>
    past([0, 0, 0, 0], [0, 0, 0, 0], 0.25, current, tracedKept).reflectionPastAgrees(
      place(z),
      noise,
      0.01,
    )
  assert.equal(agrees(0.25, 0), true, 'the same depth')
  assert.equal(agrees(0.254, 0), true, 'within half the thickness (0.005)')
  assert.equal(agrees(0.256, 0), false, 'past half of it at the least vote')
  assert.equal(agrees(0.256, 1), true, 'within twice it (0.02) at the greatest')
  assert.equal(agrees(0.275, 1), false, 'past twice it')
  assert.equal(agrees(0.25, 0.5, 1, 0.9), true, 'the depth kept, not this image’s')
  // Where the depth held is not the last image’s, this image’s opaque depth stands in for it.
  assert.equal(agrees(0.9, 0.5, 0, 0.9), true, 'this image’s depth')
  assert.equal(agrees(0.25, 0.5, 0, 0.9), false)
  assert.equal(
    past([0, 0, 0, 0]).reflectionPastAgrees({ pixel: [10, 10], z: 0.25, valid: false }, 0.5, 0.01),
    false,
    'a place the last image did not hold',
  )
})
