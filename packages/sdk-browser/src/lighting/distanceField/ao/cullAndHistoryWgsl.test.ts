// The distance-field occlusion's culling of the meshes to the view and its history's reprojection, run on the shipped text.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { builtins } from '../../../materials/texture/shaderRunBuiltins.fixture.ts'
import { DFAO_CULL_OBJECTS_WGSL } from './cullWgsl.ts'
import { DFAO_UPDATE_HISTORY_WGSL } from './historyWgsl.ts'
import { DFAO_FLAG } from './layout.ts'

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** `dfCullDistanceSquared` (the shared cull's) of the vector `v` from a mesh to the eye, the view looking along +z. */
function distanceSquared(v: number[], perspective: boolean) {
  const { dfCullDistanceSquared } = shaderRun<{
    dfCullDistanceSquared: (v: number[], perspective: boolean, forward: number[]) => number
  }>(DFAO_CULL_OBJECTS_WGSL, ['dfCullDistanceSquared'], {})
  return dfCullDistanceSquared(v, perspective, [0, 0, 1])
}

test('an orthographic view culls a mesh by its length over its depth along the view, so one off the axis is farther', () => {
  // A mesh 100 deep and 300 to the side: (|v|² / depth)², not the depth squared.
  assert.equal(distanceSquared([300, 0, 100], false), 1000 * 1000)
  assert.equal(distanceSquared([-300, 40, -100], false), (101600 / 100) ** 2)
  assert.equal(distanceSquared([0, 0, 100], false), 100 * 100)
  // Under a perspective projection it is the squared length.
  assert.equal(distanceSquared([300, 0, 100], true), 300 * 300 + 100 * 100)
})

/** The history's motion of the cell at the texel (3, 3): the word the velocity stage drew there, then what the
 *  cell moves by, the camera moving the image by `shift`, `vectors` saying whether the stage drew any. */
function motionOf(shift: number, vectors = true) {
  let word = 0
  const run = shaderRun<{
    dfaoMotion: (texel: number[], ndc: number[], depth: number) => number[]
    encodeOwnVector: (v: number[], own: boolean) => number
  }>(DFAO_UPDATE_HISTORY_WGSL, ['dfaoMotion', 'encodeOwnVector'], {
    dfao: {
      counts: [0, 0, 0, vectors ? DFAO_FLAG.velocity : 0],
      grid: [0, 0, 64, 64],
      depth: [1, 0, 1, 0],
      clipToPreviousClip: builtins.mat4x4f(...IDENTITY.slice(0, 12), shift, 0, 0, 1),
    },
    surfaceVectors: { load: () => [word] },
  })
  return (v: number[], own: boolean) => {
    word = run.encodeOwnVector(v, own)
    return run.dfaoMotion([3, 3], [0.2, -0.1], 100)
  }
}

test("the history takes the velocity stage's vector only where the surface moves by itself, else the camera's motion", () => {
  const near = (a: number[], b: number[]) =>
    a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 5e-4, `${a} ${b}`))
  const camera = [-0.1, 0]
  // A still surface's word holds the camera's motion of the texel it was drawn at: it is not read.
  near(motionOf(0.1)([0.3, 0.2], false), camera)
  // A surface that moves by itself keeps its vector.
  near(motionOf(0.1)([0.3, 0.2], true), [0.3, 0.2])
  // No vector drawn: the camera's alone.
  near(motionOf(0.1, false)([0.3, 0.2], true), camera)
})
