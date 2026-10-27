// The sky light's capture is made under the shape of the air the quality settings and the project switch
// `localFogVolumeSupport` make (`./encodeSkyLight.ts`), also where the scene has no atmosphere: with the
// switch off, no program of the capture holds any of the local fog volumes' code.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { SKY_QUALITY_RULES } from '../../../../sdk-core/src/modules/sky/quality.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { airShapeKey, airShapeOf } from '../../lighting/atmosphere/shape.ts'
import { createFogStandIns } from '../../lighting/fog/read.ts'
import { applySkyToRuntime, followSkyModule } from './encodeCloudsSky.ts'
import { encodeSkyCapture } from './encodeSkyLight.ts'
import { runtime, SCENE, word } from './skyFollow.fixture.ts'
import { skyLightStateOf } from './skyLightState.ts'

/** The shape of the air the capture of a scene with a sky light, clouds and no atmosphere is made under,
 *  with the project switch `local`. */
function captureShape(local: boolean) {
  installGpuGlobals()
  const { device } = fakeDevice({ limits: { maxTextureDimension2D: 8192 } })
  const rt = runtime({})
  const main = { overrides: {} }
  Object.assign(rt.setup, { localFog: local })
  Object.assign(rt, {
    views: { main, active: main },
    capture: { capturing: false },
    diag: { diagnosticFailure() {} },
  })
  Object.assign(rt.lights, { buffer: device.createBuffer({ size: 4096, usage: 0x80 }) })
  const placeholders = { fog: createFogStandIns(device).read }
  Object.assign(rt.gpu, { device, deferred: { placeholders } })
  applySkyToRuntime(rt, word({ skyLight: true, clouds: true }), SCENE)
  followSkyModule(rt, device)
  encodeSkyCapture(rt, device, device.createCommandEncoder())
  const state = skyLightStateOf(rt)
  assert.ok(state.capture, 'the capture is made')
  return state.shape
}

test('the capture of a scene with no atmosphere follows the project switch of the local fog volumes: the shape it is made under holds the switch', () => {
  const quality = resolveSettings(SKY_QUALITY_RULES, {})
  assert.equal(captureShape(false), airShapeKey(airShapeOf(quality, false)), 'off')
  assert.equal(captureShape(true), airShapeKey(airShapeOf(quality, true)), 'on')
})
