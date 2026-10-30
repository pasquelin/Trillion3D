import assert from 'node:assert/strict'
import test from 'node:test'
import { radiosityProbesDrawWgsl, radiosityProbesListWgsl } from './radiosityProbesWgsl.ts'

test('the listing marks the probe invalid where its jittered texel holds no surface and keeps the mean of the valid texels round the cell', () => {
  assert.match(radiosityProbesListWgsl, /let lower=inCard\+vec2u\(\(lp\.spacing-1u\)\/2u\);/)
  assert.match(radiosityProbesListWgsl, /let own=radTexel\(page,inCard\+pageJitter\(page\)\);/)
  assert.match(radiosityProbesListWgsl, /if\(!pageHasProbes\(page\)\)\{return;\}/)
  assert.match(radiosityProbesListWgsl, /position\/f32\(BOUNCE_CM\)-viewEye\(\)/)
  assert.match(radiosityProbesListWgsl, /if\(count==0u\)\{return;\}/)
  assert.match(radiosityProbesListWgsl, /if\(!\(own\.inside&&own\.valid\)\)\{packed=0xffffffffu;\}/)
  assert.match(radiosityProbesListWgsl, /atomicAdd\(&drawArgs\[1\],1u\)/)
})

test('the fragment cuts the sphere out of the cube, is pink for an invalid probe and reads the harmonics along the normal', () => {
  assert.match(radiosityProbesDrawWgsl, /if\(t<0\.0\)\{discard;\}/)
  assert.match(radiosityProbesDrawWgsl, /var shown=vec3f\(1\.0,0\.0,1\.0\);/)
  assert.match(radiosityProbesDrawWgsl, /tvBasis\(normal\)\*vec4f\(TV_L0,TV_L1,TV_L1,TV_L1\)/)
  assert.match(radiosityProbesDrawWgsl, /irradiance\/PI\*probeDraw\.invPreExposure/)
  assert.match(radiosityProbesDrawWgsl, /invPreExposure\*view\.preExposure\.x/)
  assert.match(radiosityProbesDrawWgsl, /probeDraw\.showInvalid!=0u/)
  assert.doesNotMatch(radiosityProbesDrawWgsl, /view\.inverseViewProjection|viewRay/)
  assert.doesNotMatch(radiosityProbesDrawWgsl, /`/)
})
