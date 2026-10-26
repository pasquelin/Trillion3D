// A sun's cascades laid by the frame (`sunCascades`) travel to its clipmap, where the passes of the
// distance-field cascade read them: the plan's lights, by channel.

import test from 'node:test'
import assert from 'node:assert/strict'
import { perspectiveProjection } from '../../../../../math/src/projection/camera.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import type { SunCascades } from '../../../../../sdk-core/src/contracts/sunCascades.ts'
import { createVsmFrameState } from './frameState.ts'
import { planVirtualShadowFrame } from './frameSetup.ts'
import { createVsmResources } from './resources.ts'

const CASCADES: SunCascades = {
  edge: 427,
  distanceField: {
    ...{ near: 400, far: 512, minDepth: 373, maxDepth: 512 },
    ...{ fadeOffset: 500, invFadeLength: 1 / 12, nearFadeOffset: 373, invNearFadeLength: 1 / 27 },
  },
}

test('a sun’s cascades are on the clipmap its plan holds, with the edge of its far-shadow test', () => {
  const { device } = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 },
  })
  const res = createVsmResources(device, {
    fullMapCapacity: 127,
    sunMapCapacity: 35,
    poolPages: 256,
  })
  const state = createVsmFrameState(device, res)
  const sun: SceneLight = {
    ...{ id: 'sun', kind: 'directional', direction: [0, -1, 0.2], color: [1, 1, 1] },
    ...{ intensity: 1, castsShadow: true },
  }
  const eye: [number, number, number] = [0, 2, 0]
  const camera = {
    ...{ projection: perspectiveProjection(new Float64Array(16), 60, 4 / 3, 0.1, 1) },
    ...{ view: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -2, 0, 1]), eye },
    perspective: true,
  }
  const plan = planVirtualShadowFrame(
    state,
    [{ light: sun, farShadowEdge: CASCADES.edge, cascades: CASCADES }],
    camera,
    { width: 800, height: 600 },
  )
  const { light } = plan.lights[0].clipmap!
  assert.equal(light.cascades, CASCADES)
  assert.equal(light.farShadowEdge, 427)
  // A light the frame laid none for has none on its clipmap.
  const next = planVirtualShadowFrame(state, [{ light: sun }], camera, { width: 800, height: 600 })
  assert.equal(next.lights[0].clipmap!.light.cascades, undefined)
})
