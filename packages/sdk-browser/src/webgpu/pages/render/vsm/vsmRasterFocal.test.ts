// The non-cluster shadow raster measures its screen error with the main view's focal length in
// pixels, `focalPixels(cam.projection, width, height)` (`vsmProject.ts` encodeVsmRaster). It was
// `Math.max((p[0]·width) / 2, (p[5]·height) / 2)`: the same number for every camera whose
// projection scales are positive, the product's operands only swapped. Declared fix: a mirrored
// orthographic box (left > right, bottom > top) or a negative zoom gave a negative scale, a
// nonsense pixel size for the shadow LOD; the magnitudes give the mirror image's own size.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngineCamera, writeEngineCamera } from '../../../../camera/engineCamera.ts'
import { focalPixels } from '../../../../../../math/src/projection/camera.ts'
import { HALTON_SWEEP, haltonSpan } from '../../../../../../math/src/sequence/sweep.fixture.ts'

const cam = createEngineCamera()

/** The former expression, the oracle. */
const oldFocalPixels = (p: Float64Array, width: number, height: number) =>
  Math.max((p[0] * width) / 2, (p[5] * height) / 2)

/** Camera `i` of the sweep: a field of 20° to 100° or an orthographic box (one in four), a zoom of
 *  0.25 to 8, its sign and the box's axes flipped when `mirrored`; a target of 64 to 4096 pixels. */
function camera(i: number, mirrored: boolean) {
  const half = haltonSpan(i, 2, 0.5, 500),
    across = mirrored && i % 2 ? -half : half,
    up = mirrored && i % 3 ? -half : half
  const zoom = haltonSpan(i, 3, 0.25, 8)
  writeEngineCamera(cam, {
    fov: haltonSpan(i, 5, 20, 100),
    aspect: haltonSpan(i, 7, 0.5, 2.5),
    near: haltonSpan(i, 11, 0.01, 1),
    far: 1e5,
    zoom: mirrored && i % 5 < 2 ? -zoom : zoom,
    orthographic: i % 4 ? null : { left: -across, right: across, top: up, bottom: -up },
  })
  return [Math.round(haltonSpan(i, 13, 64, 4096)), Math.round(haltonSpan(i, 17, 64, 4096))]
}

test('the raster focal length is the former one for every camera that is not mirrored', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const [width, height] = camera(i, false)
    const old = oldFocalPixels(cam.projection, width, height)
    assert.ok(old > 0, `camera ${i}`)
    assert.ok(Object.is(focalPixels(cam.projection, width, height), old), `camera ${i}`)
  }
})

test('a mirrored camera takes a positive focal length, its mirror image', () => {
  let flipped = 0
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const [width, height] = camera(i, true)
    const p = cam.projection
    if (oldFocalPixels(p, width, height) < 0) flipped++
    assert.ok(focalPixels(p, width, height) > 0, `camera ${i}`)
    const mirror = Float64Array.from(p)
    mirror[0] = Math.abs(p[0])
    mirror[5] = Math.abs(p[5])
    assert.equal(focalPixels(p, width, height), oldFocalPixels(mirror, width, height))
  }
  assert.ok(flipped > 0, 'the sweep meets the former negative scale')
})
