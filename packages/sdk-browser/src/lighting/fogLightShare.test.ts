// What weighs a light of the fog volume (`fogScatterRun.fixture.ts`): its share, the shadow its flag asks for,
// and the fade of a spot's cone and a rectangle's plane over a number of cells. Split from `fogLights.test.ts`.
import { kindLane } from '../../../sdk-core/src/scene/light/lanes.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { LIGHT_FLAG, type SceneLight } from '../../../sdk-core/src/scene/light/contracts.ts'
import { validateSceneLight } from '../../../sdk-core/src/scene/light/validate.ts'
import { recordOf } from './direct/lightReach.fixture.ts'
import { cross, subtract, unit } from '../../../math/src/vector/vectorTuple.ts'
import { pointOf } from './fogVolumeRun.fixture.ts'
import { CELL, SUN, lampAt, lit, type Light } from './fogScatterRun.fixture.ts'

test('a light’s share scales what the fog scatters of it and a share of none leaves it out; the sky has one', () => {
  const lamp = lampAt(pointOf(CELL))
  const full = lit({ lights: [lamp] })
  assert.ok(full > 0)
  near(
    [lit({ lights: [{ ...lamp, params: [0, -1, 0.25, -2] }] })],
    [full * 0.25],
    'a quarter',
    1e-6,
  )
  near([lit({ lights: [{ ...lamp, params: [0, -1, 0, -2] }] })], [0], 'none of it', 0)
  const sky = lit({ sky: [3, 3, 3] })
  near([lit({ sky: [3, 3, 3], skyShare: 0.5 })], [sky * 0.5], 'half the sky', 1e-6)
  near([lit({ sky: [3, 3, 3], skyShare: 0 })], [0], 'no sky light, no sky', 0)
})

test('the sun and a local light shadow the fog only where their flag says so, by their shadow slot’s read', () => {
  const lamp = lampAt(pointOf(CELL))
  const whole = lit({ lights: [lamp] })
  const sun = lit({ lights: [SUN], sunRank: 0 })
  assert.ok(whole > 0 && sun > 0)
  const reads: number[] = []
  near(
    [lit({ lights: [SUN], sunRank: 0, shade: 0.25, shadowReads: reads })],
    [sun / 4],
    'sun shade',
    1e-6,
  )
  assert.deepEqual(reads, [SUN.params[0]], 'asked once, of the sun')
  // A lamp that does not shadow the fog is lit whole, whatever its shadow reads.
  reads.length = 0
  near([lit({ lights: [lamp], shade: 0.5, shadowReads: reads })], [whole], 'not flagged', 1e-6)
  assert.deepEqual(reads, [], 'an unflagged lamp reads no shadow')
  // Flagged, it takes the share its shadow lets through.
  const flagged = { ...lamp, params: [kindLane(LIGHT_FLAG.shadowsFog), 3, 1, -2] }
  near([lit({ lights: [flagged], shade: 0.25 })], [whole * 0.25], 'flagged', 1e-6)
  near([lit({ lights: [flagged], shade: 0 })], [0], 'in shadow', 0)
})

test('a rectangle that casts and shadows the fog, as the contract admits it, takes the share its slot lets through', () => {
  const P = pointOf(CELL)
  const centre = [P[0] + 1, P[1] + 3, P[2] + 0.5]
  const n = unit(subtract(P, centre))
  const panel = {
    ...{ id: 'panel', kind: 'rect', position: centre, range: 40, direction: n },
    ...{ right: unit(cross(n, [0, 1, 0])), size: [1, 1], color: [1, 1, 1], intensity: 50 },
  } as SceneLight
  // The light as the store packs it (`writeLightFields`), its shadow slot given as the plan gives it.
  const packed = (castsShadow: boolean, shadowsFog: boolean) => {
    const record = recordOf(validateSceneLight({ ...panel, castsShadow, shadowsFog }))
    return { ...record, params: [record.params[0], 3, 1, -2] } as Light
  }
  const whole = lit({ lights: [packed(false, false)] })
  assert.ok(whole > 0)
  const reads: number[] = []
  // A rectangle that casts but does not shadow the fog is lit whole, its shadow unread.
  near(
    [lit({ lights: [packed(true, false)], shade: 0.25, shadowReads: reads })],
    [whole],
    'not flagged',
    1e-6,
  )
  assert.deepEqual(reads, [], 'an unflagged rectangle reads no shadow')
  const flagged = packed(true, true)
  near([lit({ lights: [flagged], shade: 0.25, shadowReads: reads })], [whole / 4], 'flagged', 1e-6)
  assert.deepEqual(reads, [flagged.params[0]], 'asked once, of the rectangle')
  near([lit({ lights: [flagged], shade: 0 })], [0], 'in shadow', 0)
})

test('a spot’s cone and a rectangle’s plane fade over a number of cells, so that they flicker less', () => {
  const P = pointOf(CELL)
  // The flat cell: its point to the far corner of the cell on its slice, what a cell of fade is.
  const cell = Math.hypot(...subtract(P, pointOf([4, 5, 2])))
  const fade = 1 // cells
  const settings = { volumetricFogEdgeFade: fade }
  const share = (light: Light) => lit({ lights: [light], settings }) / lit({ lights: [light] })
  // A spot looking straight down from 3 m above the point, a 60° cone: its aperture at the point's
  // depth is 3 · tan 60°, and the point lies 0.3 fade inside it.
  const aperture = 3 * Math.tan(Math.PI / 3)
  const spot: Light = {
    positionRange: [P[0] + aperture - 0.3 * cell, P[1] + 3, P[2], 40],
    colorIntensity: [1, 1, 1, 50],
    directionCone: [0, -1, 0, 0.5],
    params: [kindLane(1), -1, 1, 1],
    shape: [0, 0, 0, 0],
    capsule: [0, 0, 0, 0],
    traits: [0, 0, 0, 0],
  }
  near([share(spot)], [0.3], 'spot', 2e-3)
  // Well inside, no fade; and a point lamp has none, whatever the number.
  assert.equal(share({ ...spot, positionRange: [P[0] + 0.1, P[1] + 3, P[2], 40] }), 1)
  assert.equal(share(lampAt(P)), 1)
  // A rectangle facing up, the point 0.4 fade in front of its plane.
  const rect: Light = {
    positionRange: [P[0], P[1] - 0.4 * cell, P[2], 40],
    colorIntensity: [1, 1, 1, 50],
    directionCone: [0, 1, 0, -2],
    params: [kindLane(3), -1, 1, -2],
    shape: [1, 0, 0, 0.5],
    capsule: [0, 0, 0, 0],
    traits: [0, 0, 0, 0],
  }
  near([share(rect)], [0.4], 'rect', 2e-3)
  assert.equal(share({ ...rect, positionRange: [P[0], P[1] - 5 * cell, P[2], 40] }), 1)
})
