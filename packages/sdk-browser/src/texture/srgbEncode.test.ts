import test from 'node:test'
import assert from 'node:assert/strict'
import { linearToSrgb } from '../../../sdk-core/src/math/primitives/color.ts'
import { shaderRun } from './shaderRun.fixture.ts'
import { SRGB_ENCODE_GLSL, SRGB_ENCODE_WGSL } from './srgbEncode.ts'
import { SHADER } from '../webgpu/pages/prepare/shaders.ts'
import { OUTPUT_TRANSFER_GLSL } from '../webgl/core/outputGlsl.ts'

const { linearToSrgb: shaded } = shaderRun<{ linearToSrgb: (c: number[]) => number[] }>(
  SRGB_ENCODE_WGSL,
  ['linearToSrgb'],
  {},
)

// The definition, not the host library's rounded exponent: the shader text run in double precision
// meets the sRGB definition to its literals' last digit.
test('the WGSL encode is the sRGB curve', () => {
  for (const c of [-1, -1e-3, 0, 1e-4, 0.0031308, 0.0031309, 0.01, 0.18, 0.5, 0.9, 1, 4])
    for (const value of shaded([c, c, c]))
      assert.ok(Math.abs(value - linearToSrgb(c)) < 2e-9, `${c}: ${value} vs ${linearToSrgb(c)}`)
})

test('the exponent literal is the f32 nearest 1/2.4', () => {
  const exponent = /pow\(max\(c,vec3f\(0\.0\)\),vec3f\(([\d.]+)\)\)/.exec(SRGB_ENCODE_WGSL)?.[1]
  assert.equal(Math.fround(Number(exponent)), Math.fround(1 / 2.4))
  assert.ok(SRGB_ENCODE_GLSL.includes(`vec3(${exponent})`), 'one exponent for both languages')
})

test('the threshold belongs to the linear branch in both languages', () => {
  assert.match(SRGB_ENCODE_WGSL, /c<=vec3f\(0\.0031308\)/)
  assert.match(SRGB_ENCODE_GLSL, /lessThanEqual\(x,vec3\(0\.0031308\)\)/)
})

test('the shaders that encode take the shared text', () => {
  assert.ok(SHADER.includes(SRGB_ENCODE_WGSL), 'WebGPU fallback draw')
  assert.ok(OUTPUT_TRANSFER_GLSL.includes(SRGB_ENCODE_GLSL), 'WebGL2 output transfer')
  assert.doesNotMatch(SHADER + OUTPUT_TRANSFER_GLSL, /0\.41666\)/)
})
