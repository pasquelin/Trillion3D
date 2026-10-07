// The shadow passes share one text of each helper (`VSM_PROJECTION_DATA_WGSL`): the clipmap level
// and distance, the cube face, a view's depth from device depth, a local map's pixel footprint and a
// sun's back face. The marking, the projection and the blended surfaces' traced read call them with
// their own view's words; no pass holds a copy of its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { vsmVariants } from '../gpu/core/engineShaders.vsm.fixture.ts'
import { VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { directShadowWgsl } from '../lighting/direct/shadowWgsl.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'

const SHARED = [
  'vsmLevelOfDistanceSq',
  'vsmDistanceSqToOrigin',
  'vsmCubeFace',
  'vsmViewDepthOfDeviceZ',
  'vsmLocalPixelFootprint',
  'vsmFacesAwayFromSun',
]
/** A pass's own copy of a shared helper would be a function of the same role under another name. */
const COPY =
  /fn (\w*(?:CubeFace|LevelOfDistance|DistanceSqToOrigin|ViewDepthOf|PixelFootprint|FacesAway)\w*)\(/g

test('one text of each shared helper, in every pass that declares it', () => {
  for (const name of SHARED)
    assert.equal(wgslSource(VSM_PROJECTION_DATA_WGSL).split(`fn ${name}(`).length, 2, name)
  const texts: Record<string, string> = {
    ...vsmVariants(),
    TRACED_READ: wgslModule(directShadowWgsl(18, { traced: true })),
  }
  for (const [module, code] of Object.entries(texts)) {
    for (const name of SHARED)
      assert.ok(code.split(`fn ${name}(`).length <= 2, `${module} declares ${name} once at most`)
    for (const [, name] of code.matchAll(COPY))
      assert.ok(
        SHARED.includes(name) || name === 'vsmFacesAwayFromLocal',
        `${module}: no copy ${name}`,
      )
  }
  // The marking reads its own view's words, the projection its own.
  const marking = texts.VSM_MARKING_PIXELS,
    projection = texts.VSM_PROJECTION
  assert.ok(marking.includes('vsmViewDepthOfDeviceZ(deviceZ,vsmMarking.depthFromDeviceZ)'))
  assert.ok(projection.includes('vsmViewDepthOfDeviceZ(deviceZ,vsmView.depthFromDeviceZ)'))
  assert.ok(marking.includes(',vsmMarking.viewToClip,vec2f(vsmMarking.viewSize))'))
  assert.ok(projection.includes(',vsmView.viewToClip,vsmView.viewPixels.xy)'))
})
