// The resolve's work, counted over a small atrium: every listed light shaded once, moving or still,
// the shadow setup only where a list holds a shadowed light — nowhere with no shadow slot.
import test from 'node:test'
import assert from 'node:assert/strict'
import { camera } from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts'
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts'
import { countResolveWork } from './resolveWorkCount.ts'

const lights = atriumLamps(200, 4)
const { eye, yaw, pitch } = ATRIUM_POSES[1]
const view = camera(eye, yaw, pitch, 60, 432, 279)
const depths = atriumDepth(view)

test('every listed light is shaded, each reaching slot read once', () => {
  const { covered, work } = countResolveWork(
    view,
    depths,
    lights,
    lights.map((_, rank) => rank < 64),
  )
  assert.ok(work.shaded > covered && work.shadows > 0)
  assert.ok(work.shadows <= work.shaded)
  assert.equal(work.shadows, work.demand)
  assert.ok(work.setup <= covered)
})

test('with no shadow slot no pixel sets up a shadow read', () => {
  const { work } = countResolveWork(
    view,
    depths,
    lights,
    lights.map(() => false),
  )
  assert.equal(work.setup + work.shadows + work.demand, 0)
})
