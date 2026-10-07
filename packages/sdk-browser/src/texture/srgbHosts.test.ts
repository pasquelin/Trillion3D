import test from 'node:test'
import assert from 'node:assert/strict'
import { linearToSrgb } from '../../../math/src/wgsl/color.ts'
import { MATERIAL_MIP_WGSL } from './mipsWgsl.ts'
import { DISPLAY_ROUTE_WGSL } from '../webgpu/blend/displayFilter.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'

test('the encode declares the f32 nearest 1/2.4, its threshold on the linear branch', () => {
  const exponent = /pow\(max\(c,vec3f\(0\.0\)\),vec3f\(([\d.e-]+)\)\)/.exec(linearToSrgb.text)?.[1]
  assert.equal(Math.fround(Number(exponent)), Math.fround(1 / 2.4))
  assert.match(linearToSrgb.text, /c<=vec3f\(0\.0031308\)/)
})

test('the shaders that encode take the library text', () => {
  for (const [name, shader] of [
    ['material mips', MATERIAL_MIP_WGSL],
    ['display route', wgslSource(DISPLAY_ROUTE_WGSL)],
  ]) {
    assert.ok(shader.includes(linearToSrgb.text), name)
    assert.doesNotMatch(shader, /0\.41666\)/, name)
  }
})
