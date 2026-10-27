// The projection onto the hair strands (`hairProjectionWgsl.ts`): the passes of the opaque projection over
// the pixels of the tiles with strands, at the depth of the nearest strand, a strand read as a hair that
// no surface backs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { vsmLayout } from '../layout.ts'
import { vsmHairLocalsProjectionWgsl, vsmHairSunsProjectionWgsl } from './hairProjectionWgsl.ts'

const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 63, sunMapCapacity: 18 })
const suns = vsmHairSunsProjectionWgsl(layout)
const locals = vsmHairLocalsProjectionWgsl(layout, 'rg32uint')

test('a pixel is a tile’s of the list of all the tiles with strands, valid where a strand holds its depth', () => {
  const at = suns.indexOf('fn vsmPixelOf')
  const pixel = suns.slice(at, suns.indexOf('\n}\n', at))
  assert.ok(pixel.includes('let listed=rank<vsmHairCounts[0];'))
  assert.ok(pixel.includes('p.info.valid=p.inRect&&deviceZ>0.0;'))
  assert.ok(pixel.includes('textureLoad(vsmHairDepth,coord,0).x'))
})

test('a strand is a hair with no surface: no screen ray, no normal, no light through its shadow', () => {
  const at = suns.indexOf('fn vsmPixelOf')
  const pixel = suns.slice(at, suns.indexOf('\n}\n', at))
  assert.ok(pixel.includes('p.info.subsurface=true;'), 'the trace casts no screen ray')
  assert.ok(pixel.includes('p.info.hair=true;'), 'its receiver plane faces the light')
  assert.ok(pixel.includes('p.info.opacity=-1.0;'), 'it lets no light through')
  for (const name of ['vsmFlags', 'vsmNormalRough', 'vsmSurfaceOf', 'vsmLobes'])
    assert.ok(!suns.includes(name), `no surface: ${name}`)
})

test('the receiver is moved toward each light by the normal bias, light by light', () => {
  const receiver = suns.slice(suns.indexOf('fn vsmHairReceiverOf'))
  assert.ok(receiver.includes('r.P+=axis*vsmNormalOffset(r.P-vsmView.shiftedEye);'))
  assert.ok(suns.includes('vsmHairReceiverOf(pixel,vsmView.lights[k],inLight)'))
  assert.ok(locals.includes('vsmHairReceiverOf(pixel,vsmView.lights[k],inLight)'))
})

test('both passes write their masks only in the pixels of a tile', () => {
  assert.ok(suns.includes('textureStore(vsmSunMask,pixel.pos,k,'))
  assert.ok(locals.includes('textureStore(vsmLocalMask,pixel.pos,mask)'))
  assert.ok(suns.includes('@compute @workgroup_size(64)'))
})
