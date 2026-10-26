// camera.ts: framing by flat bounds and core `sphereFromBounds`.
import '../../wasm/sdkWasm.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createExplorerCamera } from './camera.ts'
import { assertBits } from '../../../../../tests/kit/assert/bits.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'

const canvas = { width: 800, height: 450 } as unknown as HTMLCanvasElement

test('createExplorerCamera frames the unit box about the origin on a scene with no geometry', () => {
  const source = new Group()
  source.add(new Group())
  // One empty-box rule (`frameBounds`): the page poses the camera itself, the framing takes the
  // unit box, whose half-diagonal is √3.
  const framed = createExplorerCamera(source, canvas, { manifestUrl: '' })
  assertBits([framed.bounds.min.x, framed.bounds.min.y, framed.bounds.min.z], [-1, -1, -1])
  assertBits([framed.bounds.max.x, framed.bounds.max.y, framed.bounds.max.z], [1, 1, 1])
  assertBits([framed.center.x, framed.center.y, framed.center.z], [0, 0, 0])
  assert.ok(Object.is(framed.radius, Math.sqrt(3)), `radius: ${framed.radius}`)
})
