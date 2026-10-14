// The resolve's work, counted over a small atrium: every listed light shaded once, moving or still,
// the shadow setup only where a list holds a shadowed light — nowhere with no shadow slot.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  camera,
  pixelPoint,
} from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts'
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts'
import { countResolveWork } from './resolveWorkCount.ts'
import { reaches } from './lightGridWalk.ts'

const lights = atriumLamps(200, 4)
const { eye, yaw, pitch } = ATRIUM_POSES[1]
const view = camera(eye, yaw, pitch, 60, 432, 279)
const depths = atriumDepth(view)

/** Every covered pixel against every light, no grid: the slotted lights that reach it. */
function reachingBruteForce(slotted: boolean[]) {
  let reaching = 0
  for (let y = 0; y < view.height; y++)
    for (let x = 0; x < view.width; x++) {
      const z = depths[y * view.width + x]
      if (!(z > 0)) continue
      const p = pixelPoint(view, x, y, z)
      reaching += lights.filter((light, rank) => slotted[rank] && reaches(p, light)).length
    }
  return reaching
}

test('every listed light is shaded, each reaching slot read once', () => {
  const slotted = lights.map((_, rank) => rank < 64)
  const { covered, work } = countResolveWork(view, depths, lights, slotted)
  assert.ok(work.shaded > covered && work.shadows > 0)
  assert.ok(work.shadows <= work.shaded)
  // The grid lists every light that reaches a pixel of its cell: its counts are the brute force's.
  const reaching = reachingBruteForce(slotted)
  assert.equal(work.shadows, reaching)
  assert.equal(work.demand, reaching)
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
