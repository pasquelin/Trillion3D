import assert from 'node:assert/strict'
import test from 'node:test'
import { materialPropertiesWgsl } from './materialProperties.ts'
import { AT, MATERIAL_WORDS, materialPropertiesLines } from './materialPropertiesText.ts'

/** The words of a pixel read: physical model, a copper-like base, rough 0.4. */
function physical() {
  const w = new Float32Array(MATERIAL_WORDS)
  w.set([0.8, 0.4, 0.2, 1], AT.base)
  w.set([0, 0, 1, 0.4], AT.normal)
  w.set([0, 0, 0, 0.5], AT.emission)
  w.set([2, 0, 0, 1], AT.model)
  w.set([10, 20], AT.pixel)
  w.set([0.8, 0.4, 0.2, 0.5], AT.f0)
  return w
}

test('the kernel reads the surfaces and the lobes under the cursor and writes the ten vectors', () => {
  assert.match(materialPropertiesWgsl, /fn debugMaterialProperties\(/)
  assert.match(
    materialPropertiesWgsl,
    /let pixel=min\(vec2u\(query\.cursor\.xy\/query\.cursor\.zw\*vec2f\(size\)\)/,
  )
  assert.match(materialPropertiesWgsl, /found:array<vec4f,10>/)
  assert.match(
    materialPropertiesWgsl,
    /found\[9\]=vec4f\(surfaceF0\(base\.rgb,base\.a\),surfaceSpecular\)/,
  )
  assert.match(materialPropertiesWgsl, /if\(\(flags&64u\)!=0u\)/)
  assert.doesNotMatch(materialPropertiesWgsl, /`/)
})

test('a pixel with no surface prints its mode and no closure', () => {
  const w = new Float32Array(MATERIAL_WORDS)
  w.set([0, 0, 0, 1], AT.model)
  assert.deepEqual(materialPropertiesLines(w), [
    'Pixel: 0 0',
    'Closure Count = 0   Material Mode = None',
  ])
})

test('nothing is printed before the pixel was read', () => {
  assert.deepEqual(materialPropertiesLines(new Float32Array(MATERIAL_WORDS)), [])
})

test('a metal prints its slab: diffuse nil, F0 the base, no emission line', () => {
  const lines = materialPropertiesLines(physical())
  assert.equal(lines[1], 'Closure Count = 1   Material Mode = Physical')
  assert.equal(lines[2], 'AO 0.500   TopRoughness 0.400')
  assert.ok(lines.includes('  Diffuse 0.000 0.000 0.000'))
  assert.ok(lines.includes('  F0 0.800 0.400 0.200   Specular 0.500'))
  assert.ok(!lines.some((line) => line.includes('Emissive')))
})

test('a clear coat, an anisotropy and a cloth print their own fields', () => {
  const coated = physical()
  coated.set([0.5, 0.7, 0.1], AT.lobes)
  coated.set([2, 0, 1, 1], AT.model)
  coated[AT.base + 3] = 0
  const text = materialPropertiesLines(coated).join('\n')
  assert.match(text, /Material Mode = Physical - Legacy Clear Coat/)
  assert.match(text, /TopRoughness 0\.100/)
  assert.match(text, /BasisType Nor\+Tan/)
  assert.match(text, /Anisotropy 0\.500/)
  assert.match(text, /- Weight 0\.700/)
  const cloth = physical()
  cloth.set([2, 0, 2, 1], AT.model)
  cloth.set([0.9, 0.9, 0.9, 0.6], AT.cloth)
  const fuzz = materialPropertiesLines(cloth).join('\n')
  assert.match(fuzz, /Legacy Cloth/)
  assert.match(fuzz, /- Weight 0\.600/)
  cloth.set([1, 2, 3], AT.emission)
  assert.match(materialPropertiesLines(cloth).join('\n'), /Emissive 1\.000 2\.000 3\.000/)
})
