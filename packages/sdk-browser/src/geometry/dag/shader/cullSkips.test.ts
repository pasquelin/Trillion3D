// A test the DAG kernel does not make, on a verdict it already knows: the frustum skips an infinite
// far plane (`outsideFrustum`), which reaches the kernel as NaN and rejects no box.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './shader.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { cameraSelectionUniforms } from '../../../gpu/core/selection.ts'
import { createEngineCamera, writeEngineCamera } from '../../../camera/engineCamera.ts'
import { frustumExcludesBox } from '../../../../../math/src/geometry/frustum/box.ts'
import { frustumPlanesToLocal } from '../oracle/math.fixture.ts'

/** The planes a camera sends the kernel, `far` given, and whether `farless` reads them as farless. */
function cameraPlanes(far: number) {
  const cam = createEngineCamera()
  cam.world.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1])
  writeEngineCamera(cam, { fov: 60, aspect: 16 / 9, near: 0.1, far, zoom: 1 })
  const { planes } = cameraSelectionUniforms(cam, 1, [1280, 720])
  const bits = new Uint32Array(Float32Array.from(planes).buffer)
  return { planes: Float64Array.from(planes), farless: (bits[16] & 0x7fffffff) > 0x7f800000 }
}

test('an infinite far plane is read as absent, a declared one is tested', () => {
  assert.ok(DAG_SELECTION_SHADER.includes('if(i!=skip&&boxBehindPlane('))
  assert.equal(cameraPlanes(Infinity).farless, true)
  assert.equal(cameraPlanes(2000).farless, false)
})

test('skipping the infinite far plane keeps every box verdict, in any primitive space', () => {
  const { planes } = cameraPlanes(Infinity)
  const skipped = planes.slice()
  skipped.set([0, 0, 0, 1], 16)
  const next = lcgRandom(2222),
    local = new Float64Array(24),
    localSkipped = new Float64Array(24)
  const worlds = [
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    [0, 2, 0, 0, -2, 0, 0, 0, 0, 0, 2, 0, 5, -3, 7, 1],
  ]
  for (const world of worlds) {
    frustumPlanesToLocal(local, planes, world)
    frustumPlanesToLocal(localSkipped, skipped, world)
    assert.ok(Number.isNaN(local[16]), 'NaN through the primitive product')
    for (let n = 0; n < 5000; n++) {
      const c = [0, 1, 2].map(() => (next() - 0.5) * 2e4),
        h = [0, 1, 2].map(() => next() * 10 ** (next() * 4))
      const box = [c[0] - h[0], c[1] - h[1], c[2] - h[2], c[0] + h[0], c[1] + h[1], c[2] + h[2]]
      assert.equal(
        frustumExcludesBox(
          localSkipped,
          ...(box as [number, number, number, number, number, number]),
        ),
        frustumExcludesBox(local, ...(box as [number, number, number, number, number, number])),
      )
    }
  }
})
