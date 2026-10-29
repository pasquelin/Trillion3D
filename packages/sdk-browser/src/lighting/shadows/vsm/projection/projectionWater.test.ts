// The projection onto the single-layer water: the suns' pass over the input `water` (`projectionWgsl.ts`,
// `../inputType.ts`), an indirect dispatch over the list of the tiles that hold water into a layer of the mask a
// sun (`waterSunProjection.ts`). A pixel is the water's surface where its shading wrote a normal, at the water's
// depth; it reads no surface flags and is shaded like an opaque receiver (normal bias, back faces culled).
import test from 'node:test'
import assert from 'node:assert/strict'
import { vsmLayout } from '../layout.ts'
import { vsmSunsProjectionWgsl } from './projectionWgsl.ts'

const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 63, sunMapCapacity: 18 })
const water = vsmSunsProjectionWgsl(layout, false, 'water')
const pixelOf = (code: string) => {
  const at = code.indexOf('fn vsmPixelOf')
  return code.slice(at, code.indexOf('\n}\n', at))
}

test('a pixel is a tile’s of the list of the tiles that hold water, valid where a normal was written', () => {
  const pixel = pixelOf(water)
  assert.ok(pixel.includes('let listed=rank<vsmWaterCount.x;'))
  assert.ok(pixel.includes('let deviceZ=textureLoad(vsmSceneDepth,coord,0);'))
  assert.ok(pixel.includes('p.info.valid=p.inRect&&deviceZ>0.0&&dot(normal,normal)>0.25;'))
  assert.ok(pixel.includes('p.info.worldNormal=normalize(normal);'))
  assert.ok(water.includes('vsmPixelOf(flatIndex(groupId,groups,1u),groupIndex)'))
  assert.ok(water.includes('var<uniform> vsmWaterCount:vec4u;'), 'the count a uniform')
})

test('the water reads no surface flags, thin transmission or coat', () => {
  for (const name of ['vsmFlags', 'vsmSurfaceOf', 'vsmLobes', 'subsurfaceColor'])
    assert.ok(!water.includes(name), `${name} stays out of the water's program`)
})

test('the receiver is moved along its normal like an opaque surface, and back faces are culled', () => {
  assert.ok(water.includes('let receiver=vsmReceiverOf(pixel,pixel.info.valid);'))
  assert.ok(water.includes('vsmFacesAwayFromSun'), 'the region test of the surfaces')
})

test('the program writes a layer of the suns’ mask a sun', () => {
  assert.ok(water.includes('textureStore(vsmSunMask,pixel.pos,k,'))
})
