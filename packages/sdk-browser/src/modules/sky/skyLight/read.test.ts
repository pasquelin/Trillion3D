// The sky light's reflection read: the cube alone, whatever blend the diffuse read is in.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { skyLightReadWgsl } from './read.ts'

test('the reflection read samples the cube of its layer alone: no destination cube is mixed in during a blend, the diffuse harmonics being the blend’s', () => {
  const text = wgslModule(
    skyLightReadWgsl({ group: 0, cube: 0, sampler: 1, harmonics: 2, params: 3 }),
  )
  const reflection = /fn skyLightReflection\([^)]*\)->vec3f\{[\s\S]*?\n\}/.exec(text)![0]
  assert.equal(reflection.match(/textureSampleLevel/g)?.length, 1)
  assert.doesNotMatch(reflection, /levels\.w|layer\+1/)
  assert.match(text, /fn skyHarmonic\(k:u32\)->vec4f\{[^}]*levels\.w/)
})
