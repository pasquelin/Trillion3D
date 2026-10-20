/**
 * The engine builds and aims the core's lights (#944): each kind a scene file declares becomes a
 * `Light`, aiming only when it aims. A file's lamps reach the engine through `lights.json` alone,
 * built by `lightFromRecord` (`world/core/loadedModel.ts`).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { lightFromRecord } from '../../../../sdk-core/src/world/light/lightRecord.ts'
import { aimOf } from './kinds.ts'
import { isPlacedLight } from './graphLights.fixture.ts'

test('a lamp a scene file declares is the core light, a sun or a spot aiming down its direction', () => {
  const spot = lightFromRecord({
    id: 'lamp',
    kind: 'spot',
    color: [1, 1, 1],
    intensity: 3,
    castsShadow: true,
    position: [0, 2, 0],
    direction: [0, 0, -1],
    range: 9,
    coneAngle: 0.5,
  })
  const point = lightFromRecord({
    id: 'bulb',
    kind: 'point',
    color: [1, 1, 1],
    intensity: 2,
    castsShadow: true,
    position: [1, 0, 0],
    range: 4,
  })
  assert.ok(isPlacedLight(spot) && isPlacedLight(point))
  assert.deepEqual(
    [spot.name, spot.target.position.x, spot.target.position.y, spot.target.position.z],
    ['lamp', 0, 2, -1],
  )
  assert.equal(aimOf(spot), spot.target)
  assert.equal(aimOf(point), undefined, 'a point holds a target it never aims at')
})
