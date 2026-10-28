// The velocity stage's vectors and the passes that read them, run in JavaScript from the shipped
// text: the vector codec, the flattening, the reprojection's dilation and a placement's motion from
// its two poses.
import test from 'node:test'
import assert from 'node:assert/strict'
import { flattenShader } from '../effects/motionBlur/flattenWgsl.ts'
import { reprojectShader } from './reprojectWgsl.ts'
import { SURFACE_VELOCITY_WGSL } from './surfaceVelocityWgsl.ts'
import { velocityShader } from './nearestVelocityWgsl.ts'
import { IDENTITY_MATRIX4, multiplyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { builtins } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import { blurUniform } from '../effects/motionBlur/motionBlurRun.fixture.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { doubleWords, poseTexel } from '../../geometry/dag/worlds/worldPoses.fixture.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { transformAffinePoint } from '../../../../math/src/vector/vector.ts'
import { worldToRenderOrigin } from '../../../../math/src/projection/renderOrigin.ts'
import { MARKED_RESPONSIVE_WGSL, RESPONSIVE_MARK_WGSL } from '../../visibility/types.ts'
import { close, type Vec } from './taaBuiltins.fixture.ts'

/** The vector codec, as the velocity stage's text has it (`velocityWgsl.ts`). */
const { encodeOwnVector, encodeVector, decodeVector, hasOwnMotion } = shaderRun<{
  encodeOwnVector: (v: number[], own: boolean) => number
  encodeVector: (v: number[]) => number
  decodeVector: (word: number) => number[]
  hasOwnMotion: (word: number) => boolean
}>(SURFACE_VELOCITY_WGSL, ['encodeOwnVector', 'encodeVector', 'decodeVector', 'hasOwnMotion'], {})
/** The depth step a pixel's flags word carries in its high half (`velocityWgsl.ts`). */
const { withDepthStep, depthStepOf } = shaderRun<{
  withDepthStep: (flags: number, step: number) => number
  depthStepOf: (flags: number) => number
}>(SURFACE_VELOCITY_WGSL, ['withDepthStep', 'depthStepOf'], {})
/** The view the camera moved by 0.1 along x, whose still surfaces are carried by `(−0.1, 0)`; an
 *  orthographic one where `ortho`, a cut where `cut`. */
const movedView = ({ ortho = false, cut = false } = {}) => ({
  prevViewProj: builtins.mat4x4f(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0, 0, 1),
  invViewProj: builtins.mat4x4f(...IDENTITY_MATRIX4),
  render: [64, 32, 1 / 64, 1 / 32],
  params: [cut ? 1 : 0, 0, 0, 0],
  radius: [0, 0, 1, ortho ? 1 : 0],
})

/** The responsiveness mark a layer writes and the nearest velocity reads (`visibility/types.ts`). */
const { responsiveMark, markedResponsive } = shaderRun<{
  responsiveMark: (code: number) => number
  markedResponsive: (mark: number) => number
}>(
  wgslProgram('', [RESPONSIVE_MARK_WGSL, MARKED_RESPONSIVE_WGSL]),
  ['responsiveMark', 'markedResponsive'],
  {},
)

test('a responsiveness code survives its mark in an 8-bit target, and the largest of two marks keeps both codes', () => {
  const stored = (mark: number) => Math.round(mark * 255) / 255
  for (const code of [0, 1, 3]) assert.equal(markedResponsive(stored(responsiveMark(code))), code)
  // The union of the codes is their largest, which the target's max blend keeps in any order.
  const both = Math.max(stored(responsiveMark(1)), stored(responsiveMark(3)))
  assert.equal(markedResponsive(both), 1 | 3)
  // Past its two bits a word reads as its low two.
  assert.equal(responsiveMark(4 | 1), responsiveMark(1))
})

test("a pixel's flags carry its depth step in their high half, the flags kept whole", () => {
  for (const flags of [0, 1, 2, 3])
    for (const step of [0, 1e-6, -1e-6, 3e-4, -3e-4, 0.25, -0.25]) {
      const word = withDepthStep(flags, step)
      assert.equal(word & 0xffff, flags, `flags ${flags} with step ${step}`)
      const back = depthStepOf(word)
      assert.ok(
        Math.abs(back - step) <= Math.abs(step) * 2 ** -10 + 2 ** -24,
        `step ${step} came back ${back}`,
      )
      assert.equal(Math.sign(back), Math.sign(step), `the sign of ${step}`)
    }
})

test('a vector says in its first code whether the surface moved by itself, to a step of the code', () => {
  for (const v of [
    [0, 0],
    [0.001, -0.002],
    [0.3, 0.7],
    [-1.5, 1.9],
  ])
    for (const own of [true, false]) {
      const word = encodeOwnVector(v, own)
      assert.equal(hasOwnMotion(word), own)
      // The code is read as it was, one step of its first axis apart at the most.
      const plain = decodeVector(encodeVector(v)),
        flagged = decodeVector(word)
      assert.ok(Math.abs(flagged[0] - plain[0]) <= 2e-4 && flagged[1] === plain[1], `${v} ${own}`)
    }
})

test("the flattening takes the corner's own motion where it moves by itself, else the camera's at the pixel", () => {
  // The corner (4, 4) of the pixel (3, 3) holds the word `word` at depth 0.5.
  const run = (
    word: number,
    { cancel = false, ...view }: { cancel?: boolean; ortho?: boolean; cut?: boolean } = {},
  ) =>
    shaderRun<{ cornerMotion: (pixel: Vec, nearest: Vec) => Vec }>(
      flattenShader(),
      ['cornerMotion'],
      {
        mb: { ...blurUniform, knobs: [16, 0, 1, cancel ? 1 : 0] },
        view: movedView(view),
        depthTexture: { load: () => 0.5 },
        vectors: { load: () => [word] },
      },
    ).cornerMotion([3, 3], [4, 4])
  // A foreground's vector the 3×3 dilated onto a still texel: not its own, never read as it is.
  const dilated = encodeOwnVector([0.3, 0.2], false)
  close(run(dilated), [-0.1, 0, 0.5])
  close(run(dilated, { cancel: true }), [0, 0, 0.5])
  // Held down by the depth under an orthographic projection, cancelled all the same.
  close(run(dilated, { ortho: true }), [-0.05, 0, 0.5])
  close(run(dilated, { ortho: true, cancel: true }), [0, 0, 0.5])
  // A surface that moves by itself keeps its own vector, the camera's taken out of it where asked.
  const own = encodeOwnVector([0.3, 0.2], true)
  close(run(own), [0.3, 0.2, 0.5])
  close(run(own, { cancel: true }), [0.4, 0.2, 0.5])
  close(run(own, { cut: true }), [0, 0, 0.5])
})

test('the reprojection dilates the stage’s vectors by the closest surface its marks name', () => {
  // The texel (5, 5) took the neighbour at the offset its marks' first nibble codes.
  const code = (x: number, y: number) => x + 1 + (y + 1) * 4
  const run = (offset: Vec, word: number) =>
    shaderRun<{ dilatedVector: (texel: Vec) => Vec }>(
      reprojectShader('rgba8unorm'),
      ['dilatedVector'],
      {
        view: movedView(),
        marks: { load: () => [0, 0, 0, code(offset[0], offset[1])] },
        vectors: { load: (at: Vec) => [at[0] === 6 ? word : encodeOwnVector([-0.1, 0], false)] },
        depth: { load: () => 0.5 },
      },
    ).dilatedVector([5, 5])
  // A neighbour that moves by itself lends its own vector; one that does not, the camera's motion at
  // the texel with its depth; none taken, the texel's own word.
  close(run([1, 0], encodeOwnVector([0.3, 0.2], true)), [0.3, 0.2])
  close(run([1, 0], encodeOwnVector([0.7, 0.7], false)), [-0.1, 0])
  close(run([0, 0], encodeOwnVector([0.7, 0.7], false)), [-0.1, 0])
})

/** Two record tables of one placement, its pose now and before (`poseTexel` reads them). */
const poses = { now: { pose: [...IDENTITY_MATRIX4] }, before: { pose: [] as number[] } }

// Every surface's own motion is measured whatever its size on the screen, as the visibility buffer's
// are (the per-object size option is gone): a placement whose pose moved draws its motion, from its
// two poses (`placementMotion`), and a still one leaves its texel to the camera's motion.
test('a placement whose pose moved is measured by its motion, whatever its size; a still one is not', () => {
  const moved = new Array(16).fill(0).map((_, at) => (at % 5 === 0 ? 1 : at === 12 ? 0.5 : 0))
  for (const before of [moved, [...IDENTITY_MATRIX4]]) {
    poses.before.pose = before
    const run = shaderRun<{
      drawsMotion: (id: number) => boolean
      surfaceMotion: (screen: number[], z: number, id: number, moves: boolean) => number[]
    }>(SURFACE_VELOCITY_WGSL, ['drawsMotion', 'surfaceMotion'], {
      view: {
        eye: [0, 0, 0, 0],
        radius: [0, 0, 1, 0],
        params: [0, 0, 1, 0],
        render: [8, 8, 0.125, 0.125],
        exactEye: [
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
        prevViewProj: builtins.mat4x4f(...IDENTITY_MATRIX4),
        invViewProj: builtins.mat4x4f(...IDENTITY_MATRIX4),
      },
      pages: new Proxy([], { get: () => ({ deformOutput: 0, placement: 0 }) }),
      worlds: poses.now,
      previous: poses.before,
      textureLoad: (table: unknown, at: number[]) => poseTexel(table, at[0]),
    })
    const moves = before === moved
    assert.equal(run.drawsMotion(1), moves)
    const [vx] = run.surfaceMotion([0.25, 0.25], 0.5, 1, run.drawsMotion(1))
    assert.equal(Math.abs(vx) > 1e-6, moves, 'a moving object is measured by its motion')
  }
})

// The analysis reads the vector the stage wrote (a texel, 16 bits per axis and a half-float depth
// step) where it once measured the surface again from the poses. The two differ by the codec's
// quantization alone, which is the reference's too (it reads the encoded velocity texel, not the
// exact one): a code is `1/65535` of the range `g = sqrt(2|v|)` is stored over, scaled by `0.499/2`,
// so a vector is off by at most one and a half code (the lowest bit holds the own-motion flag),
// `1.5 · g / (65535 · 0.2495)`; the depth step is a half float, off by at most `2^-10` of itself
// (plus `2^-25` below its normal range). A static, a moved, a deformed and a displaced-by-offset
// surface all go through the same codec; the pose set covers each size of vector.
test('the velocity read from the stage differs from the exact one by one and a half code at most', () => {
  const stage = { encodeOwnVector, decodeVector, withDepthStep, depthStepOf }
  const exact = [
    { name: 'static', v: [-0.1, 0], dz: 0 },
    { name: 'still pixel', v: [0, 0], dz: 0 },
    { name: 'moved', v: [0.0123, -0.3071], dz: 0.00042 },
    { name: 'deformed', v: [-0.5, 0.25], dz: -0.01 },
    { name: 'offset', v: [1.2e-4, -3e-5], dz: 1e-6 },
    { name: 'fast', v: [1.4, -0.9], dz: 0.2 },
  ]
  for (const { name, v, dz } of exact) {
    const word = stage.encodeOwnVector(v, true)
    const got = stage.decodeVector(word)
    // The step travels in the pixel's flags word, apart from the vector's.
    const step = stage.depthStepOf(stage.withDepthStep(0, dz))
    for (let axis = 0; axis < 2; axis++) {
      const bound = (1.5 * Math.sqrt(2 * Math.abs(v[axis]))) / (65535 * 0.2495) + 1e-7
      assert.ok(
        Math.abs(got[axis] - v[axis]) <= bound,
        `${name} axis ${axis}: ${got[axis]} for ${v[axis]}`,
      )
    }
    assert.ok(Math.abs(step - dz) <= Math.abs(dz) * 2 ** -10 + 2 ** -25, `${name} depth step`)
  }
})

// How far the closest surface moved by itself is measured in the world, between where it stands and
// where its vector says it stood (the last view's inverse); the texel's current pixel position
// takes the closest neighbour's vector, at the closest depth. A surface the camera alone carries
// moved by none, whatever its vector holds — the off-screen one of a point that was behind the last
// view included —, and a point at infinity (no depth, w = 0, current or past) has no distance.
test('a surface the camera alone carries is not moving, nor is a point at infinity; one that moves by itself is', () => {
  const identity = builtins.mat4x4f(...IDENTITY_MATRIX4)
  // w = z: a point at zero depth is a direction.
  const atInfinity = builtins.mat4x4f(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0)
  const run = (
    nearest: number[],
    { zc = 0.5, closestZ = 0.5, now = identity, before = identity } = {},
  ) =>
    shaderRun<{
      isMoving: (p: Vec, zc: number, z: number, n: number[], animated: boolean) => number
    }>(velocityShader(), ['isMoving'], {
      view: {
        render: [8, 8, 1 / 8, 1 / 8],
        // Depth 1/z, a pixel radius of a thousandth of it.
        depth: [0, 1, 1, 0],
        radius: [0.001, 0, 1, 0],
        parallax: [0, 0, 0, 0],
        rates: [0, 0, 0, 0],
        prevViewProj: identity,
        invViewProj: now,
        prevInvViewProj: before,
      },
    }).isMoving([3, 3], zc, closestZ, nearest, false)
  // The off-screen vector a point behind the last view gets, on a surface that does not move.
  assert.equal(run([4, 4, 0, 0]), 0)
  // A vector of the camera's alone, however long.
  assert.equal(run([0.5, 0, 0, 0]), 0)
  // A surface that moved by half the screen is moving; one that moved by a tenth of a pixel is not.
  assert.equal(run([0.5, 0, 0, 1]), 1)
  assert.equal(run([1e-4, 0, 0, 1]), 0)
  // No division where the point now, or the point it stood at, is at infinity: not moving.
  assert.equal(run([0.5, 0, 0, 1], { zc: 0, closestZ: 0, now: atInfinity }), 0)
  assert.equal(run([0.5, 0, 0.5, 1], { before: atInfinity }), 0)
})

// The velocity takes a placement's motion from its two poses in the cut's tables (`placementMotion`)
// where a CPU mirror of every root once wrote it: the same `previous · current⁻¹`, anchored at the
// eye — its translation `M · (eye, 1) − eye` —, here computed in doubles as that mirror did, against
// the shader's single-precision product of the worlds taken at the eye.
test('a placement’s motion from its two poses is previous · current⁻¹ at the eye, turned, scaled and moved far', () => {
  const pose = (angle: number, scale: number, t: number[]) => {
    const c = Math.cos(angle) * scale,
      s = Math.sin(angle) * scale
    return [c, 0, -s, 0, 0, scale, 0, 0, s, 0, c, 0, t[0], t[1], t[2], 1]
  }
  const eye = [1234.5, -20.25, 98765.125]
  const eyeWords = [
    [...doubleWords(eye[0]), ...doubleWords(eye[1])],
    [...doubleWords(eye[2]), 0, 0],
  ]
  for (const [now, before] of [
    [pose(0.2, 1, [1240, -18, 98770]), pose(0.25, 1, [1241, -18, 98769.5])],
    [pose(1.1, 2.5, [1200, -25, 98700]), pose(1.0, 2.5, [1199.75, -25.5, 98700.25])],
  ]) {
    poses.now.pose = now
    poses.before.pose = before
    const { placementMotion } = shaderRun<{ placementMotion: (w: number) => { m: number[][] } }>(
      SURFACE_VELOCITY_WGSL,
      ['placementMotion'],
      {
        view: { exactEye: eyeWords },
        worlds: poses.now,
        previous: poses.before,
        textureLoad: (table: unknown, at: number[]) => poseTexel(table, at[0]),
      },
    )
    const inverse = new Float64Array(16),
      motion = new Float64Array(16),
      expected = new Float64Array(16)
    invertMatrix4(inverse, Float64Array.from(now))
    multiplyMatrix4(motion, Float64Array.from(before), inverse)
    transformAffinePoint(motion, motion, eye[0], eye[1], eye[2], 12)
    worldToRenderOrigin(expected, motion, eye, 0)
    const got = placementMotion(0).m.flat()
    for (let k = 0; k < 16; k++)
      assert.ok(
        Math.abs(got[k] - expected[k]) < 1e-4,
        `entry ${k}: ${got[k]} against ${expected[k]}`,
      )
  }
})

// A placement whose two poses are the same words moves nothing, and a singular one has no inverse to
// move by: both are the identity, exactly (`placementMotionAtEye`), where a product of a world and
// its inverse would leave rounding behind.
test('a placement that did not move, or whose world is singular, has exactly the identity for its motion', () => {
  const c = 1.7 * Math.cos(0.3),
    s = 1.7 * Math.sin(0.3)
  const turned = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1.7, 0, 4.25, -2.5, 7.125, 1]
  const flat = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1]
  for (const [now, before] of [
    [turned, turned],
    [flat, turned],
  ]) {
    poses.now.pose = now
    poses.before.pose = before
    const { placementMotion } = shaderRun<{ placementMotion: (w: number) => { m: number[][] } }>(
      SURFACE_VELOCITY_WGSL,
      ['placementMotion'],
      {
        view: {
          exactEye: [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
          ],
        },
        worlds: poses.now,
        previous: poses.before,
        textureLoad: (table: unknown, at: number[]) => poseTexel(table, at[0]),
      },
    )
    assert.deepEqual(placementMotion(0).m.flat(), Array.from(IDENTITY_MATRIX4))
  }
})
