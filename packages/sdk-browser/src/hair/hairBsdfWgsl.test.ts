// The hair BSDF and its table: the rules of the reference they follow, read in their text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { HAIR_BSDF_WGSL, HAIR_COMPONENT, hairScatteringWgsl } from './hairBsdfWgsl.ts'
import { HAIR_LUT_WGSL } from './hairLutWgsl.ts'
import { hairLutKey } from './hairLutPass.ts'
import { hairLutAbsorptions } from './hairLutSize.ts'

test('the three lobes are the fits of the reference: R by the separable Gaussian, TT and TRT by the exponentials of the azimuth', () => {
  const code = HAIR_BSDF_WGSL.text
  assert.match(code, /np=exp\(-3\.65\*cosPhi-3\.98\)/)
  assert.match(code, /np=exp\(17\.0\*cosPhi-16\.78\)/)
  assert.match(code, /n_prime=1\.19\/cosD\+0\.36\*cosD/)
  assert.match(code, /hairF\(sqrt\(saturate\(0\.5\+0\.5\*vol\)\)\)/)
})

test('the multiple scattering joins the dual scattering to the lobes and the result is never below 0', () => {
  const code = HAIR_BSDF_WGSL.text
  assert.match(code, /s=td\.globalScattering\*\(s\+td\.localScattering\)\*td\.opaqueVisibility;/)
  assert.match(code, /return max\(s,vec3f\(0\.0\)\)/)
  assert.equal(HAIR_COMPONENT.multiScatter, 0x20)
})

test('the dual scattering takes the hair count one less and the roughness between 0.18 and 0.6', () => {
  const code = hairScatteringWgsl(0, 0).text
  assert.match(code, /hairCount=max\(0\.0,mask\.x-1\.0\)/)
  assert.match(code, /clamp\(roughnessIn,0\.18,0\.6\)/)
  assert.match(code, /mix\(vec3f\(1\.0\),tf\*sf\*df,saturate\(hairCount\)\)/)
})

test('the table is the hair BSDF averaged over the sphere in two halves, and its absorption slices are a square', () => {
  assert.match(HAIR_LUT_WGSL, /if\(sampleDirection\.x>0\.0\)\{back\+=value;backCount\+\+;\}/)
  assert.deepEqual([1, 2, 4, 15, 16, 17].map(hairLutAbsorptions), [1, 1, 4, 9, 16, 16])
  assert.equal(
    hairLutKey({ angles: 64, roughnesses: 64, absorptions: 16, sampleScale: 1 }),
    '64 64 16 1',
  )
})
