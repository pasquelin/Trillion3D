import test from 'node:test'
import assert from 'node:assert/strict'
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import { canvasRay, createWorldRaycast } from './worldRaycast.ts'
import { Ray } from '../../../../sdk-core/src/world/math/volumes.ts'
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import { markHelper } from './helperMark.ts'
import type { Engine } from '../../engine/types.ts'
import type { RayFilter } from '../query/types.ts'

test('a canvas point aims at the shape the frame is drawn at, not the CSS box', () => {
  const camera = new Camera('perspective', { fov: 50 })
  // A square CSS box whose drawing buffer is twice as wide: the frame is drawn at 2 : 1.
  const canvas = { clientWidth: 400, clientHeight: 400, width: 800, height: 400 }
  const ray = canvasRay(camera, canvas as HTMLCanvasElement, { x: 400, y: 200 })
  const edge = camera.rayThrough(1, 0, 2)
  assert.ok(ray.direction.distanceTo(edge.direction) < 1e-12)
})

/** A world's raycast over an engine that records what it is asked, and answers nothing. */
function recordedRaycast(engine = true) {
  const asked: Array<{ ray: Ray; filter?: RayFilter }> = []
  const castRay = (ray: Ray, filter?: RayFilter) => (
    asked.push({ ray, filter }),
    Promise.resolve(null)
  )
  const canvas = { clientWidth: 400, clientHeight: 400, width: 400, height: 400 }
  const raycast = createWorldRaycast(
    () => new Camera('perspective', { fov: 50 }),
    canvas as HTMLCanvasElement,
    () => null,
    () => (engine ? ({ castRay } as unknown as Engine) : undefined),
  )
  return { raycast, asked }
}

test('world.raycast always answers a promise, from the engine, its direction a unit vector', async () => {
  const { raycast, asked } = recordedRaycast()
  const answer = raycast(new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -3)))
  assert.ok(answer instanceof Promise, 'a promise, never a hit at once')
  assert.equal(await answer, null)
  assert.equal(asked.length, 1, 'one ray to the engine')
  assert.ok(Math.abs(asked[0].ray.direction.length() - 1) < 1e-12)
  assert.ok(raycast({ x: 200, y: 200 }) instanceof Promise, 'a canvas point too')
  const closed = recordedRaycast(false).raycast({ x: 200, y: 200 })
  assert.equal(await closed, null, 'a world with no session answers none')
})

test('the helper marks are passed by unless asked, and the objects are handed on', () => {
  const { raycast, asked } = recordedRaycast()
  const mark = markHelper(new Group()),
    picked = new Group()
  raycast({ x: 200, y: 200 })
  assert.ok(asked[0].filter?.skip?.includes(mark), 'a helper is passed by')
  raycast({ x: 200, y: 200 }, { helpers: true, objects: [picked] })
  assert.deepEqual(asked[1].filter, { objects: [picked], skip: [] })
})
