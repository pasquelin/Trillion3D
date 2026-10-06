import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { pixelFootprintOf } from './priority.ts'
import { engineCamera } from '../camera/camera.fixture.ts'

function camera() {
  const cam = G.perspectiveCamera(55, 16 / 9, 0.1, 1000)
  cam.position.set(0, 0, 5)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  cam.updateProjectionMatrix()
  return cam
}

test('the pixel footprint is 2 / (|P[5]| · height), to the bit', () => {
  const perspective = engineCamera(camera()).projection
  const orthographic = [0.1, 0, 0, 0, 0, -0.37, 0, 0, 0, 0, -0.01, 0, 0, 0, 0, 1]
  for (const projection of [perspective, orthographic])
    for (const height of [0, 1, 720, 1081]) {
      const footprint = 2 / (Math.abs(projection[5]) * Math.max(1, height))
      assert.equal(pixelFootprintOf(projection, height), footprint)
    }
})
