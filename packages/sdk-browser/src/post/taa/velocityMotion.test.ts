// The velocity stage's vectors and the passes that read them, run in JavaScript from the shipped
// text: the vector codec, the flattening, the reprojection's dilation and a placement's motion from
// its two poses.
import test from 'node:test'
import assert from 'node:assert/strict'
import { flattenShader } from '../effects/motionBlur/flattenWgsl.ts'
import { reprojectShader } from './reprojectWgsl.ts'
import { SURFACE_VELOCITY_WGSL } from './surfaceVelocityWgsl.ts'
import { IDENTITY_MATRIX4, multiplyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { builtins } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import { blurUniform } from '../effects/motionBlur/motionBlurRun.fixture.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { WORLD_TABLE } from '../../geometry/dag/worlds/worldTable.ts'
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

/** A double's two words, high then low, as the roots' world boxes keep them. */
const doubleWords = (value: number) => {
  const words = new Uint32Array(new Float64Array([value]).buffer)
  return [words[1], words[0]]
}

/** Two record tables of one placement, its pose now and before (`poseTexel` reads them). */
const poses = { now: { pose: [...IDENTITY_MATRIX4] }, before: { pose: [] as number[] } }
/** Texel `x` of placement 0's record in `table`, each field in its own block of a row
 *  (`WORLD_TABLE`): a matrix column's single-precision words, the exact translation's double words
 *  (x and y, then z), its instance. */
const poseTexel = (table: unknown, x: number) => {
  const m = (table as { pose: number[] }).pose
  const origin = 1024 * WORLD_TABLE.fields.Matrix
  if (x < 4) return [...new Uint32Array(new Float32Array(m.slice(4 * x, 4 * x + 4)).buffer)]
  if (x === origin) return [...doubleWords(m[12]), ...doubleWords(m[13])]
  if (x === origin + 1) return [...doubleWords(m[14]), 0, 0]
  return [0, 0, 0, 0]
}

// Every surface's own motion is measured whatever its size on the screen, as the visibility buffer's
// are (the per-object size option is gone): a placement whose pose moved draws its motion, from its
// two poses (`placementMotion`), and a still one leaves its texel to the camera's motion.
test('a placement whose pose moved is measured by its motion, whatever its size; a still one is not', () => {
  const moved = new Array(16).fill(0).map((_, at) => (at % 5 === 0 ? 1 : at === 12 ? 0.5 : 0))
  for (const before of [moved, [...IDENTITY_MATRIX4]]) {
    poses.before.pose = before
    const run = shaderRun<{
      drawsMotion: (id: number) => boolean
      texelMotion: (p: number[], q: number[], z: number, id: number) => { velocity: number[] }
    }>(SURFACE_VELOCITY_WGSL, ['drawsMotion', 'texelMotion'], {
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
    const [vx] = run.texelMotion([4, 4], [4, 4], 0.5, 1).velocity
    assert.equal(Math.abs(vx) > 1e-6, moves, 'a moving object is measured by its motion')
  }
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
