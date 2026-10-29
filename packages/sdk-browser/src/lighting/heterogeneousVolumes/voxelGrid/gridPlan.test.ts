// The plan of the voxel grids: bounds, smallest voxel, resolutions of the top levels, the frustum grid's near and far.
import test from 'node:test'
import assert from 'node:assert/strict'
import { frustumPlanesFromMatrix } from '../../../../../math/src/geometry/frustum/frustum.ts'
import {
  clipNearFarDistances,
  frustumGridResolution,
  frustumGridViewToWorld,
  globalBoundsAndMinimumVoxelSize,
  outwardFrustumPlanes,
  tanHalfFov,
  topLevelGridResolution,
  unionBounds,
  viewBoundsAndMinimumVoxelSize,
  viewFrustumCorners,
  type GridSettings,
  type GridView,
} from './gridPlan.ts'

const SETTINGS: GridSettings = {
  maxTraceDistance: 30000,
  downsampleFactor: 1,
  minimumVoxelSizeInFrustum: 0.1,
  minimumVoxelSizeOutsideFrustum: 100,
  bottomLevelGridResolution: 4,
  indirectionGrid: true,
  indirectionGridResolution: 4,
  frustumGridShadingRate: 4,
  orthoGrid: true,
  orthoGridShadingRate: 4,
  frustumGridDepthSliceCount: 512,
  farPlaneAutoTransition: true,
}

/** A camera at the origin looking along +z, 90 degrees, whose frustum is the clip box of the identity. */
const planes = new Float64Array(24)
frustumPlanesFromMatrix(planes, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const VIEW: GridView = {
  origin: [0, 0, 0],
  right: [1, 0, 0],
  up: [0, 1, 0],
  forward: [0, 0, 1],
  fovDegrees: 90,
  width: 1920,
  height: 1080,
  planes,
}
const volume = (z: number, size = 0.5, minimumVoxelSize = 0.1) => ({
  origin: [0, 0, z] as const,
  extent: [size, size, size] as const,
  radius: size * Math.sqrt(3),
  minimumVoxelSize,
})

test('the tangent of half a field of view', () => {
  assert.ok(Math.abs(tanHalfFov(90) - 1) < 1e-12)
})

test('the union of two boxes is the box that holds both', () => {
  const a = { origin: [0, 0, 0] as const, extent: [1, 1, 1] as const }
  const b = { origin: [4, 0, 0] as const, extent: [1, 2, 1] as const }
  assert.deepEqual(unionBounds(a, b), { origin: [2, 0, 0], extent: [3, 2, 1] })
  assert.deepEqual(unionBounds(undefined, a), a)
})

test('the view bounds take the volumes in the frustum and the voxel their distance projects, the smaller of it and the volume minimum', () => {
  const near = volume(0.5)
  const outside = { ...volume(0.5), origin: [5, 0, 0.5] as const }
  const { bounds, minimumVoxelSize } = viewBoundsAndMinimumVoxelSize(
    VIEW,
    [near, outside],
    { shadingRateInFrustum: 4, shadingRateOutOfFrustum: 4, useProjectedPixelSize: false },
    SETTINGS,
  )
  assert.deepEqual(bounds, { origin: [0, 0, 0.5], extent: [0.5, 0.5, 0.5] })
  const away = Math.max(0.5 - Math.hypot(0.5, 0.5, 0.5), 0)
  assert.equal(away, 0)
  // At the camera the projected voxel is nothing: the volume's own minimum stands.
  assert.equal(minimumVoxelSize, 0.1)
  const none = viewBoundsAndMinimumVoxelSize(
    VIEW,
    [outside],
    { shadingRateInFrustum: 4, shadingRateOutOfFrustum: 4, useProjectedPixelSize: false },
    SETTINGS,
  )
  assert.equal(none.bounds, undefined)
  assert.equal(none.minimumVoxelSize, 100)
})

test('the global bounds hold every volume and the voxel is held to the in-frustum minimum where the volumes meet a view', () => {
  const options = {
    shadingRateInFrustum: 4,
    shadingRateOutOfFrustum: 8,
    useProjectedPixelSize: true,
  }
  const far = { ...volume(0.5, 0.5, 0.001), origin: [0, 0, 0.9] as const }
  const { bounds, minimumVoxelSize } = globalBoundsAndMinimumVoxelSize(
    [VIEW],
    [far],
    options,
    SETTINGS,
  )
  assert.deepEqual(bounds, { origin: far.origin, extent: far.extent })
  // The projected voxel is 0 (the volume starts at the camera), the volume asks 0.001, the in-frustum minimum lifts it to 0.1.
  assert.ok(Math.abs(minimumVoxelSize - 0.1) < 1e-12)
  const none = globalBoundsAndMinimumVoxelSize([VIEW], [], options, SETTINGS)
  assert.equal(none.bounds, undefined)
  assert.equal(none.minimumVoxelSize, 100)
})

test('the top-level resolution covers the bounds with the cells of the bottom and indirection levels at the smallest voxel, held to 128 x 128 x 256', () => {
  const bounds = { origin: [0, 0, 0] as const, extent: [10, 10, 10] as const }
  assert.deepEqual(topLevelGridResolution(bounds, 0.1, SETTINGS), [13, 13, 13])
  assert.deepEqual(
    topLevelGridResolution(bounds, 0.1, { ...SETTINGS, indirectionGrid: false }),
    [50, 50, 50],
  )
  const huge = { origin: [0, 0, 0] as const, extent: [1000, 1000, 1000] as const }
  assert.deepEqual(topLevelGridResolution(huge, 0.1, SETTINGS), [128, 128, 256])
  assert.deepEqual(
    topLevelGridResolution({ ...bounds, extent: [0, 0, 0] }, 0.1, SETTINGS),
    [1, 1, 1],
  )
})

test('a negative near or far takes the distance the sphere of the bounds begins or ends at; the near is held to 0.01, the far past the sphere', () => {
  const bounds = { origin: [0, 0, 10] as const, extent: [1, 1, 1] as const }
  const radius = Math.sqrt(3)
  const both = clipNearFarDistances(VIEW, bounds, -1, -1)
  assert.ok(Math.abs(both.near - (10 - radius)) < 1e-12)
  assert.ok(Math.abs(both.far - (10 + radius)) < 1e-12)
  const given = clipNearFarDistances(VIEW, bounds, 1, 5)
  assert.equal(given.near, 1)
  // The far is held to one past the sphere's near.
  assert.ok(Math.abs(given.far - (10 - radius + 1)) < 1e-12)
  assert.equal(clipNearFarDistances(VIEW, { ...bounds, origin: [0, 0, -50] }, -1, -1).near, 0.01)
})

test('the frustum grid has a cell for each shading-rate square of the view and slice of depth, over the bottom level, its far plane stopped where a pixel spans the smallest voxel', () => {
  const { resolution, far } = frustumGridResolution(VIEW, 0.1, 1, 1000, SETTINGS)
  const optimal = 0.1 / Math.tan((2 * (Math.PI / 4)) / 480)
  assert.ok(Math.abs(far - optimal) < 1e-9)
  const depth = Math.min(Math.ceil(512 / 4), Math.ceil((optimal - 1) / 0.1))
  assert.deepEqual(resolution, [120, 68, Math.ceil(depth / 4)])
  // Without the ortho grid to take over, the far plane stays.
  const kept = frustumGridResolution(VIEW, 0.1, 1, 1000, { ...SETTINGS, orthoGrid: false })
  assert.equal(kept.far, 1000)
  assert.deepEqual(kept.resolution, [120, 68, 32])
  // A far plane before the near one leaves one cell of depth.
  assert.equal(frustumGridResolution(VIEW, 0.1, 10, 5, SETTINGS).resolution[2], 1)
})

test('the grid view space is x right, y up, z along the view, and the planes face outward round the frustum', () => {
  const m = frustumGridViewToWorld({ ...VIEW, origin: [1, 2, 3] })
  assert.deepEqual(Array.from(m), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1])
  const corners = viewFrustumCorners([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  assert.equal(corners.length, 8)
  assert.deepEqual(corners[0], [-1, -1, 1])
  const outward = outwardFrustumPlanes(corners)
  const distances = (p: readonly number[]) =>
    [0, 1, 2, 3, 4].map(
      (k) =>
        outward[k * 4] * p[0] +
        outward[k * 4 + 1] * p[1] +
        outward[k * 4 + 2] * p[2] +
        outward[k * 4 + 3],
    )
  assert.ok(
    distances([0, 0, 0.5]).every((d) => d < 0),
    'inside is behind every plane',
  )
  // Past the near plane, past each side: in front of one plane.
  assert.ok(distances([0, 0, 2])[0] > 0)
  assert.ok(distances([2, 0, 0.5])[1] > 0)
  assert.ok(distances([0, 2, 0.5])[2] > 0)
  assert.ok(distances([-2, 0, 0.5])[3] > 0)
  assert.ok(distances([0, -2, 0.5])[4] > 0)
})
