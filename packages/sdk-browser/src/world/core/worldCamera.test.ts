import test from 'node:test'
import assert from 'node:assert/strict'
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import { drawnView } from '../../../../math/src/projection/camera.ts'
import { hostFramingCamera } from '../../host/scene/graphObjects.ts'
import { followPageCamera } from './worldCamera.ts'
import { canvasRay } from './worldRaycast.ts'

const box = { left: -1, right: 3, top: 3, bottom: -1 }
const drawn = (camera: Camera, width: number, height: number) => {
  const session = hostFramingCamera(50, 1, 0.1, 100)
  followPageCamera(() => camera, { width, height } as HTMLCanvasElement)(session)
  // The box is handed on as declared and fitted where a projection is composed.
  const [x, y, w, h] = drawnView(session.orthographic!, session.aspect, 1)
  return { left: x - w, right: x + w, top: y + h, bottom: y - h }
}

test('an orthographic camera fitted to the aspect keeps its height and centre at any canvas shape', () => {
  const camera = new Camera('orthographic', { ...box, fitAspect: true })
  assert.deepEqual(drawn(camera, 800, 400), { left: -3, right: 5, top: 3, bottom: -1 })
  assert.deepEqual(drawn(camera, 400, 800), { left: 0, right: 2, top: 3, bottom: -1 })
  assert.equal(camera.clone().fitAspect, true, 'a clone keeps the fit')
})

test('an orthographic camera draws its declared box unless it asks for the fit', () => {
  assert.deepEqual(drawn(new Camera('orthographic', box), 800, 400), box)
})

test('a fitted orthographic camera aims a canvas point where its fitted box draws it', () => {
  const camera = new Camera('orthographic', { ...box, fitAspect: true })
  const canvas = { clientWidth: 400, clientHeight: 200, width: 800, height: 400 }
  const edge = canvasRay(camera, canvas as HTMLCanvasElement, { x: 400, y: 100 })
  assert.deepEqual([edge.origin.x, edge.origin.y], [5, 1], 'the right edge of the 2 : 1 box')
})
