// The float cube converted to half floats on the GPU (`cubeHalf.ts`, `cubeHalfWgsl.ts`): the shipped WGSL text run in JavaScript, each
// texel times the scale and held to the half float's largest, alpha 1; the program assembles.
import test from 'node:test'
import assert from 'node:assert/strict'
import { HALF_MAX } from '../../../../../math/src/constants.ts'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { CUBE_HALF_ENTRY, cubeHalfShader } from './cubeHalfWgsl.ts'

test('a texel is converted times the scale, held to what a half float holds, with an alpha of 1', () => {
  const stored: number[][] = []
  const kernel = shaderRun<Record<string, (id: number[]) => void>>(
    cubeHalfShader(),
    [CUBE_HALF_ENTRY],
    {
      halfSource: {},
      halfTarget: {},
      halfFit: [0.5, 0, 0, 0],
      textureDimensions: () => [2, 2],
      textureLoad: () => [4, 1e9, 0.5, 7],
      textureStore: (_texture: unknown, _at: number[], _face: number, value: number[]) => {
        stored.push(value)
      },
    },
  )
  kernel[CUBE_HALF_ENTRY]([1, 1, 3])
  kernel[CUBE_HALF_ENTRY]([2, 0, 0])
  assert.deepEqual(stored, [[2, HALF_MAX, 0.25, 1]], 'a texel past the side is left alone')
})

test('the conversion’s program declares every name it uses and names its entry', () => {
  assertProgramAssembles(cubeHalfShader(), CUBE_HALF_ENTRY, 'the conversion')
})
