// A lamp no lit point of the frame is in reach of costs nothing: its sphere wholly behind
// one plane of the view one pixel wider, it takes no map, no page and no projection, its cache
// waiting unreferenced. A lamp whose sphere touches the view projects.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { SceneLight } from '../../../sdk-core/src/scene/light/contracts.ts'
import { perspectiveProjection } from '../../../math/src/projection/camera.ts'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createVsmResources } from './resources.ts'
import { VSM_MAP_UNSEEN } from './constants.ts'
import {
  createVsmFrameState,
  finishVirtualShadowFrame,
  planVirtualShadowFrame,
  vsmLightSeen,
  vsmSeenPlanes,
} from './frameSetup.ts'

const WIDTH = 1000,
  HEIGHT = 1000
// The eye at the origin looking down −Z, 90° vertical field, square: the side planes are the
// diagonals x = ±z, y = ±z.
const view = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const projection = perspectiveProjection(new Float64Array(16), 90, 1, 0.1, 1)
const planes = vsmSeenPlanes(new Float64Array(24), view, projection, WIDTH, HEIGHT)
const lamp = (position: [number, number, number], range: number): SceneLight => ({
  id: 'lamp',
  kind: 'point',
  position,
  range,
  color: [1, 1, 1],
  intensity: 1,
  castsShadow: true,
})

test('a lamp behind the eye is not seen; a sun always is', () => {
  assert.equal(vsmLightSeen(lamp([0, 0, 20], 5), planes), false)
  assert.equal(vsmLightSeen(lamp([0, 0, 2], 5), planes), true, 'its sphere holds the eye')
  const sun: SceneLight = { ...lamp([0, 0, 20], 1), kind: 'directional', direction: [0, -1, 0] }
  assert.equal(vsmLightSeen(sun, planes), true)
})

test('a sphere that touches the view one pixel wider is seen, one past it is not', () => {
  // At depth 10 the left plane x = −10 lies 10/√2 from a centre on x = −20, y = 0: a pixel wider
  // moves it by 10·(2/1000)/√2.
  const gap = 10 / Math.SQRT2,
    pixel = (10 * 0.002) / Math.SQRT2
  assert.equal(vsmLightSeen(lamp([-20, 0, -10], gap + pixel / 2), planes), true, 'in the pixel')
  assert.equal(vsmLightSeen(lamp([-20, 0, -10], gap + 2 * pixel), planes), true)
  assert.equal(vsmLightSeen(lamp([-20, 0, -10], gap - 2 * pixel), planes), false)
})

test('a lamp not visible takes no map and marks no page: its entry waits unreferenced', () => {
  const { device } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const state = createVsmFrameState(device, res)
  const camera = { view, projection, eye: [0, 0, 0], perspective: true }
  const viewport = { width: WIDTH, height: HEIGHT }
  const seen = lamp([0, 0, -10], 5),
    behind = { ...lamp([0, 0, 20], 5), id: 'behind' }
  const plan = (visible: boolean) => {
    const frame = planVirtualShadowFrame(
      state,
      [{ light: seen }, { light: behind, visible }],
      camera,
      viewport,
    )
    finishVirtualShadowFrame(state, frame)
    return frame
  }
  assert.deepEqual(
    plan(true).lights.map((l) => l.id),
    ['lamp', 'behind'],
  )
  const culled = plan(vsmLightSeen(behind, planes))
  assert.deepEqual(
    culled.lights.map((l) => l.id),
    ['lamp'],
    'only the seen lamp has maps',
  )
  const entry = [...state.cache.entries.values()].find((e) => e.lightId === 'behind')
  assert.ok(entry && entry.mapId >= 0, 'the culled lamp keeps its cache entry')
  assert.ok(
    entry.mapCaches.every((map) => map.projectionData.flags & VSM_MAP_UNSEEN),
    'flagged unreferenced: its coarse pages are not marked (vsmMarkCoarse)',
  )
})
