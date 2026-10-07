/**
 * The engine builds and aims the core's lights (#944): each kind a scene file declares becomes a
 * `Light`, aiming only when it aims.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { light as preparedLight } from '../prepared/nodes.ts'
import { aimOf } from './kinds.ts'
import { isPlacedLight } from './graphLights.fixture.ts'

test('a light a scene file declares is the core light, a sun or a spot aiming down its own -z', () => {
  const spot = preparedLight({ type: 'spot', intensity: 3, outerConeAngle: 0.5 } as never, 'lamp')
  const point = preparedLight({ type: 'point', intensity: 2 } as never, 'bulb')
  assert.ok(isPlacedLight(spot) && isPlacedLight(point))
  assert.deepEqual([spot.target.parent, spot.target.position.z], [spot, -1])
  assert.equal(point.target.parent, null, 'a point holds a target it never aims at')
  assert.equal(aimOf(point), undefined)
})
