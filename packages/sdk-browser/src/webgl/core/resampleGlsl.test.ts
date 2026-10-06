// #834: WebGL2 resamples with the temporal upscale's own kernel, Lanczos-2, its GLSL derived from
// the WGSL text: the two evaluate alike, and the resample reads the kernel and its 2×2 deringing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts'
import { LANCZOS2_GLSL } from '../../taa/lanczos2Wgsl.ts'
import { resampleFragment } from './resampleGlsl.ts'
import { LANCZOS2_WGSL } from '../../taa/lanczos2Wgsl.ts'

type Kernel = { lanczos2: (x: number) => number }

test('the GLSL Lanczos-2 is the WGSL one, value for value', () => {
  const scope = { sin: Math.sin }
  const glsl = shaderFunctions<Kernel>(LANCZOS2_GLSL, ['lanczos2'], scope).lanczos2,
    wgsl = shaderFunctions<Kernel>(LANCZOS2_WGSL, ['lanczos2'], scope).lanczos2
  for (let x = 0; x <= 2.5; x += 0.05) assert.equal(glsl(x), wgsl(x), `at ${x}`)
})

test('the resample weighs its 3×3 texels by Lanczos-2 and clamps to the 2×2 nearest', () => {
  for (const untoned of [false, true]) {
    const text = resampleFragment(untoned)
    assert.ok(text.includes(LANCZOS2_GLSL))
    assert.match(text, /lanczos2\(length\(vec2\(at\)-r\)\)/)
    assert.match(text, /color=clamp\(sum\/max\(total,1e-4\),lo,hi\)/)
    assert.equal(/untonedOut=/.test(text), untoned)
  }
})
