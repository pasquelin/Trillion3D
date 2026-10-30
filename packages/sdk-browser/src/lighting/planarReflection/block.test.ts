// The blocks of a planar reflection (`./block.ts`) and its geometry (`./mirror.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePlanarReflection } from '../../../../sdk-core/src/scene/planarReflection/contracts.ts'
import {
  compositeWords,
  prefilterWords,
  writeCompositeBlock,
  writePrefilterBlock,
} from './block.ts'
import {
  mirroredCameraMatrix,
  planarBoxInFrustum,
  planarImageSize,
  planarPlane,
  planeDistance,
  widenedField,
} from './mirror.ts'
import { PLANAR_COMPOSITE_LAYOUT, PLANAR_PREFILTER_LAYOUT } from './wgsl.ts'

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} against ${b}`)

test('the plane: the second column its normal, the box 20 metres times the columns, the fade-out distance along the normal', () => {
  const lake = resolvePlanarReflection({
    id: 'lake',
    matrix: [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0.5, 0, 1, 4, 5, 1],
    distanceFromPlaneFadeoutEnd: 2,
  })
  const plane = planarPlane(lake)
  assert.deepEqual(
    [plane.origin, plane.normal],
    [
      [1, 4, 5],
      [0, 1, 0],
    ],
  )
  assert.deepEqual([plane.xReach, plane.zReach, plane.normalReach], [40, 10, 6])
  near(planeDistance(plane, 7, 6.5, -2), 2.5)
  // The offset is the normal dotted with the origin, which the blocks and the distance share.
  assert.equal(plane.w, 4)
})

test('the mirrored camera: reflected across the plane, its frame turned back to determinant +1', () => {
  const plane = planarPlane(
    resolvePlanarReflection({ id: 'p', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1] }),
  )
  // A camera 5 metres above the plane, looking up and along -z at 45 degrees.
  const c = Math.SQRT1_2
  const world = [1, 0, 0, 0, 0, c, c, 0, 0, -c, c, 0, 0, 7, 0, 1]
  const out = mirroredCameraMatrix(new Float64Array(16), world, plane)
  assert.deepEqual([...out.slice(12, 15)], [0, -3, 0])
  // The mirrored camera looks down (its forward is the third column negated): the reflection of the camera's own forward.
  near(-out[9], -c)
  near(-out[10], -c)
  const det =
    out[0] * (out[5] * out[10] - out[6] * out[9]) -
    out[1] * (out[4] * out[10] - out[6] * out[8]) +
    out[2] * (out[4] * out[9] - out[5] * out[8])
  near(det, 1)
})

test('the frustum test keeps a box that meets the frustum and drops one wholly behind a plane', () => {
  const plane = planarPlane(resolvePlanarReflection({ id: 'p' }))
  // Six planes of one side each: x >= -1000 five times, then x >= 1000 (the box reaches 20 metres only).
  const planes = new Float64Array(24)
  for (let i = 0; i < 6; i++) planes.set([1, 0, 0, 1000], i * 4)
  assert.equal(planarBoxInFrustum(plane, planes), true)
  planes.set([1, 0, 0, -1000], 20)
  assert.equal(planarBoxInFrustum(plane, planes), false)
})

test('the widened field and the image size', () => {
  const scales = [1.5, 0, 0, 0, 0, 2.5]
  const fov = widenedField(scales, 2.5 / 1.5, 0)
  near(fov, (2 * Math.atan(1 / 2.5) * 180) / Math.PI)
  assert.ok(widenedField(scales, 2.5 / 1.5, 5) > fov)
  assert.deepEqual(planarImageSize(1920, 1080, 50), [960, 540])
  assert.deepEqual(planarImageSize(1921, 1081, 50), [961, 541])
  assert.deepEqual(planarImageSize(100, 100, 5), [25, 25])
})

test('the composite block: the reference fades as scale and bias, the angle fade over the cosines', () => {
  const lake = resolvePlanarReflection({
    id: 'lake',
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 3, 0, 1],
  })
  const words = compositeWords()
  writeCompositeBlock(words, lake, planarPlane(lake), new Float64Array(16).fill(1))
  const at = PLANAR_COMPOSITE_LAYOUT.at
  assert.deepEqual([...words.slice(at.plane, at.plane + 4)], [0, 1, 0, 3])
  // 0.6 to 1 metre: a scale of 2.5, a bias of -1.5.
  near(words[at.params], 2.5)
  near(words[at.params + 1], -1.5)
  near(words[at.params + 2], 5)
  // 20 to 30 degrees.
  const range = 1 / (Math.cos(Math.PI / 9) - Math.cos(Math.PI / 6))
  near(words[at.params2], range)
  near(words[at.params2 + 1], -Math.cos(Math.PI / 6) * range)
  assert.equal(words[at.xAxis + 3], 20)
})

test('the prefilter block: the kernel radius from the roughness and the width, the camera frame', () => {
  const lake = resolvePlanarReflection({ id: 'lake', prefilterRoughness: 0.02 })
  const words = prefilterWords()
  const world = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1]
  const projection = new Float64Array(16)
  projection[0] = 2
  projection[5] = 4
  writePrefilterBlock(
    words,
    lake,
    planarPlane(lake),
    { world, projection, near: 0.1 },
    [800, 450],
    [1024, 512],
  )
  const at = PLANAR_PREFILTER_LAYOUT.at
  near(words[at.kernel], 8)
  near(words[at.kernel + 1], 0.01)
  assert.deepEqual([...words.slice(at.eye, at.eye + 4)], [3, 4, 5, 0.5])
  assert.deepEqual([...words.slice(at.forward, at.forward + 3)], [-0, -0, -1])
  near(words[at.right + 3], 0.25)
})
