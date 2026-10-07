// The anisotropic and clear-coat lobes are a resolve class of their own (`physicalWgsl.ts`): only a
// lit row whose surface carries a lobe compiles their record, maps and target, and the resolve
// reads them where the frame and the request need them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { materialClassKey } from './materialClass.ts'
import { CLASS_FEATURE } from './classWords.ts'
import { FLAG_LIT, SHADE_SHADER } from '../buffer.ts'
import { PHYSICAL_LOBES_CALL, PHYSICAL_UV_READ } from './physicalWgsl.ts'
import { SHADE_REQUEST_WGSL } from './request.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

const noMaps = { rough: 0, metal: 0, ao: 0, emissive: 0, normal: 0 }

test('a lit row with a lobe is of the physical class, no other row is', () => {
  const { HAS_PHYSICAL } = CLASS_FEATURE
  assert.equal(materialClassKey(FLAG_LIT, { ...noMaps, physical: true }), HAS_PHYSICAL)
  assert.equal(materialClassKey(0, { ...noMaps, physical: true }), 0)
  assert.equal(materialClassKey(FLAG_LIT, noMaps), 0)
})

test('the resolve reads the record before its request and the lobes once its normal is final', () => {
  const fragment = SHADE_SHADER.slice(SHADE_SHADER.indexOf('fn shadeSurface'))
  const record = fragment.indexOf(PHYSICAL_UV_READ),
    lobes = fragment.indexOf(PHYSICAL_LOBES_CALL)
  assert.ok(record > 0 && record < fragment.indexOf('let request=shadeRequest('))
  // The base normal map bends the normal in its last block (the first one reads its sample).
  const bend = fragment.lastIndexOf('if(HAS_NORMAL_MAP){')
  assert.ok(lobes > bend)
  assert.ok(lobes < fragment.indexOf('return SurfaceOut(vec4f(rgb,metal)'))
  // The coat bends its own map from the normal before the base normal map.
  assert.ok(fragment.indexOf('let coatBase=N;') < bend)
  for (const text of [PHYSICAL_UV_READ, PHYSICAL_LOBES_CALL])
    assert.ok(text.startsWith('if(HAS_PHYSICAL&&page.physical!=0u'))
  // Its four maps ask their tiles after the others.
  assert.match(wgslSource(SHADE_REQUEST_WGSL), /\+select\(0u,4u,physical\);/)
  assert.match(
    wgslSource(SHADE_REQUEST_WGSL),
    /return physicalRequest\(p,missing,p\.sel-physicalFirst\);/,
  )
})
