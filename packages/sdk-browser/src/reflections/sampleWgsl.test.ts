import test from 'node:test'
import assert from 'node:assert/strict'
import { stochasticReflectionShader } from './sampleWgsl.ts'
import { contractLightingProgram } from '../lighting/deferred/shaders.ts'
import { functionsOf } from '../texture/shaderRule.fixture.ts'
import { MIRROR_TRANSITION_END } from '../lighting/shaderConstantsWgsl.ts'

const trace = (bounce: boolean, unbounded: boolean) =>
  functionsOf(stochasticReflectionShader(contractLightingProgram(bounce), { unbounded }), [
    'traceRoughReflection',
  ])

test('a rough sample spends the bounded Hi-Z walk, and a miss reads the filtered probes, never a proxy ray', () => {
  for (const bounce of [false, true]) {
    const sample = trace(bounce, false)
    assert.match(sample, /return vec4f\(boundedReflectionRay\(P,N,sample\.xyz\),sample\.w\);/)
    assert.doesNotMatch(sample, /resolvedReflectionRay|reflectedRadiance\(|proxyReflectionRay/)
    const program = stochasticReflectionShader(contractLightingProgram(bounce), {
      unbounded: false,
    })
    const ray = functionsOf(program, ['boundedReflectionRay'])
    assert.match(ray, /screenReflection\(P\+N\*shadowFootprint,R\)/)
    assert.ok(ray.includes('filteredReflectedRadiance(P,N,R,MIRROR_TRANSITION_END)'))
    assert.ok(program.includes(MIRROR_TRANSITION_END.text))
    assert.doesNotMatch(ray, /resolvedReflectionRay|proxyReflectionRay/)
  }
})

test("a reference session's program walks the whole ray with the program's whole fallback", () => {
  for (const bounce of [false, true]) {
    const sample = trace(bounce, true)
    assert.match(sample, /return vec4f\(resolvedReflectionRay\(P,N,sample\.xyz\),sample\.w\);/)
    assert.doesNotMatch(
      stochasticReflectionShader(contractLightingProgram(bounce), { unbounded: true }),
      /boundedReflectionRay/,
    )
  }
})

test('the filtered reflection is the rough branch of the full one, without its proxy ray', () => {
  const bounced = stochasticReflectionShader(contractLightingProgram(true))
  const [filtered, full] = [
    functionsOf(bounced, ['filteredReflectedRadiance']),
    functionsOf(bounced, ['reflectedRadiance']),
  ]
  assert.doesNotMatch(filtered, /proxyReflectionRay/)
  assert.match(full, /if\(weight==0\.0\)\{return filtered;\}/)
  for (const line of [
    'if(bounce.counts.w==0u){return environmentReflection(R,rough);}',
    'filteredProbeReflection(P,N,R,rough)',
  ]) {
    assert.ok(filtered.includes(line) && full.includes(line), line)
  }
})
