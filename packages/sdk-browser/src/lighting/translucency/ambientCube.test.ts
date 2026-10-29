// The translucency lighting volume's injection of the ambient cubemap: the bindings it reads the cube through and the text that adds its mean colour.
import test from 'node:test'
import assert from 'node:assert/strict'
import { INJECT_BINDING, INJECT_PROGRAM, injectProgram } from './injectWgsl.ts'

test('the injection binds the cube, its sampler and its colour past the marked cells, clear of the sampled lighting', () => {
  const { ambientCube, ambientCubeSampler, ambientCubeColour, markedCount } = INJECT_BINDING
  assert.deepEqual([ambientCube, ambientCubeSampler, ambientCubeColour], [16, 17, 18])
  assert.ok(ambientCube > markedCount)
  for (const program of [INJECT_PROGRAM, injectProgram(true)]) {
    assert.ok(program.includes(`@binding(${ambientCube}) var ambientCube:texture_cube<f32>`))
    assert.ok(program.includes(`@binding(${ambientCubeSampler}) var ambientCubeSampler:sampler`))
    assert.ok(
      program.includes(`@binding(${ambientCubeColour}) var<uniform> ambientCubeColour:vec4f`),
    )
  }
})

test('every cell of either cascade, marked or not, adds the cube mean colour (its last mip, times its colour) to its ambient light before the pre-exposure', () => {
  for (const program of [INJECT_PROGRAM, injectProgram(true)]) {
    assert.equal(program.split('ambient+=vec4f(ambientCubeAverage(),0.0);').length, 2)
    assert.ok(program.includes('f32(textureNumLevels(ambientCube)-1u)'))
    assert.ok(
      program.indexOf('ambient+=vec4f(ambientCubeAverage()') <
        program.indexOf('vec4f(ambient.rgb*tv.weights.x,ambient.a)'),
    )
  }
})
