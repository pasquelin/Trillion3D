// The rules of the depth the Hi-Z pyramid is built from: the visibility buffer's winner depth is
// the engine's reversed depth (near is greater, background is the far value), a triangle that
// covers nothing never wins, and the pyramid keeps the FARTHEST (the minimum) of every block.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { DEPTH_CLEAR } from '../camera/depthConvention.ts'
import { visibilityDepth } from './visibilityDepth.fixture.ts'
import { buildHizPyramid } from '../../../../bench/oracles/browser/hizPyramid.ts'
import { cameraAt, quad, seededRandom } from '../../../../tests/fixtures/hiz.ts'
import { engineCamera } from '../camera/camera.fixture.ts'
import { surfaceOf } from '../page/surface.ts'
import { identityRoots } from '../page/selection/placements.fixture.ts'
import { rasterVisibilityIds } from '../../../../bench/oracles/browser/cpu-image/raster.ts'
import { packVisibilityId } from '../../../../bench/oracles/browser/cpu-image/ids.ts'

test('no page and a zero viewport both stay pure background', () => {
  const depth = visibilityDepth(
    new Uint32Array(0),
    [],
    identityRoots(),
    engineCamera(cameraAt()),
    [0, 0],
  )
  assert.equal(depth.length, 0)
})

test('an id with no matching page falls back to background', () => {
  const ids = new Uint32Array(4).fill(packVisibilityId(3, 0))
  const depth = visibilityDepth(ids, [], identityRoots(), engineCamera(cameraAt()), [2, 2])
  assert.ok(depth.every((z) => z === DEPTH_CLEAR))
})

test('a degenerate (zero-area) triangle never wins a pixel', () => {
  const material = G.basicSurface()
  // Three collinear points: any pixel's barycentric area is exactly 0.
  const { page, geometry } = quad(material, [-1, 0, 0], [1, 0, 0], 'flat')
  const cam = engineCamera(cameraAt()),
    size: [number, number] = [8, 8]
  const ids = rasterVisibilityIds([page], identityRoots(), cam, size)
  const depth = visibilityDepth(ids, [page], identityRoots(), cam, size)
  assert.ok(depth.every((z) => z === DEPTH_CLEAR))
  geometry.dispose()
  material.dispose()
})

test('a covered pixel holds a depth strictly between far and near, and only covered pixels do', () => {
  const rand = seededRandom(11)
  for (let round = 0; round < 12; round++) {
    const material = G.basicSurface()
    const half = 0.3 + rand() * 1.2,
      z = -3 + rand() * 6
    const { page, geometry } = quad(material, [-half, -half, z], [half, half, z], 'q')
    const cam = engineCamera(cameraAt()),
      size: [number, number] = [9 + Math.floor(rand() * 20), 9 + Math.floor(rand() * 20)]
    const ids = rasterVisibilityIds([page], identityRoots(), cam, size)
    const depth = visibilityDepth(ids, [page], identityRoots(), cam, size)
    let covered = 0
    for (let i = 0; i < depth.length; i++)
      if (ids[i] === 0) assert.equal(depth[i], DEPTH_CLEAR)
      else {
        covered++
        assert.ok(depth[i] > DEPTH_CLEAR && depth[i] < 1, `depth[${i}] = ${depth[i]}`)
      }
    assert.ok(covered > 0, 'the generated quad lands on screen')
    geometry.dispose()
    material.dispose()
  }
})

test('the nearer a quad is to the eye, the greater its depth at the centre', () => {
  const cam = engineCamera(cameraAt()),
    size: [number, number] = [15, 15]
  let previous = DEPTH_CLEAR
  // From far to near along the view axis, the camera sits at z = 5.
  for (const z of [-40, -12, -3, 0, 2, 3.5, 4.5]) {
    const material = G.basicSurface()
    const half = 0.4 * (5 - z) // Always a wide slice of the view, whatever the distance.
    const { page, geometry } = quad(material, [-half, -half, z], [half, half, z], 'q')
    const ids = rasterVisibilityIds([page], identityRoots(), cam, size)
    const depth = visibilityDepth(ids, [page], identityRoots(), cam, size)
    const centre = depth[7 * 15 + 7]
    assert.ok(centre > previous, `z=${z}: ${centre} is not nearer than ${previous}`)
    previous = centre
    geometry.dispose()
    material.dispose()
  }
})

test('a pixel reads only its own id: blanking half the ids leaves the other half unchanged', () => {
  const material = G.basicSurface()
  const { page, geometry } = quad(material, [-1, -1, -0.3], [1, 1, -0.3], 'front')
  const cam = engineCamera(cameraAt()),
    size: [number, number] = [17, 17]
  const ids = rasterVisibilityIds([page], identityRoots(), cam, size)
  const depth = visibilityDepth(ids, [page], identityRoots(), cam, size)
  const half = ids.slice()
  for (let i = 0; i < half.length; i += 2) half[i] = 0
  const partial = visibilityDepth(half, [page], identityRoots(), cam, size)
  for (let i = 0; i < depth.length; i++)
    assert.ok(Object.is(partial[i], i % 2 === 0 ? DEPTH_CLEAR : depth[i]), `pixel ${i}`)
  geometry.dispose()
  material.dispose()
})

test('a page whose index reaches past its triangle stays background, not a thrown error', () => {
  const page = {
    array: new Uint32Array([0, 1]), // Truncated triangle: base + 2 >= index.length.
    attributes: new G.Geometry().attributes,
    matrix: new G.Matrix4(),
    material: surfaceOf(G.basicSurface()),
  }
  const ids = new Uint32Array(1).fill(packVisibilityId(0, 0))
  const depth = visibilityDepth(ids, [page], identityRoots(), engineCamera(cameraAt()), [1, 1])
  assert.equal(depth[0], DEPTH_CLEAR)
})

test('every pyramid texel is the farthest (the minimum) of the block it covers, on any size', () => {
  const rand = seededRandom(5)
  const sizes: [number, number][] = [
    [1, 1],
    [1, 9],
    [7, 1],
    [2, 2],
    [3, 5],
    [16, 16],
    [17, 31],
    [64, 33],
  ]
  for (const [w, h] of sizes) {
    const depth = new Float32Array(w * h).map(() => Math.fround(rand()))
    const pyramid = buildHizPyramid(depth, w, h)
    // The last level is one texel; each level is the ceiling of half the one below.
    assert.equal(pyramid.widths[pyramid.count - 1], 1)
    assert.equal(pyramid.heights[pyramid.count - 1], 1)
    for (let i = 0; i < w * h; i++) assert.equal(pyramid.data[i], depth[i], 'level 0 is the input')
    for (let level = 1; level < pyramid.count; level++) {
      assert.equal(pyramid.widths[level], Math.ceil(pyramid.widths[level - 1] / 2))
      assert.equal(pyramid.heights[level], Math.ceil(pyramid.heights[level - 1] / 2))
      for (let y = 0; y < pyramid.heights[level]; y++)
        for (let x = 0; x < pyramid.widths[level]; x++) {
          let expected = Infinity
          for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++) {
              const sx = 2 * x + dx,
                sy = 2 * y + dy
              if (sx < pyramid.widths[level - 1] && sy < pyramid.heights[level - 1])
                expected = Math.min(
                  expected,
                  pyramid.data[pyramid.offsets[level - 1] + sy * pyramid.widths[level - 1] + sx],
                )
            }
          assert.equal(
            pyramid.data[pyramid.offsets[level] + y * pyramid.widths[level] + x],
            expected,
          )
        }
    }
    assert.equal(pyramid.data[pyramid.offsets[pyramid.count - 1]], Math.min(...depth))
  }
})

test('a background hole reaches the top of the pyramid and a rebuild reuses the buffer', () => {
  const depth = new Float32Array(25).fill(0.6)
  depth[13] = DEPTH_CLEAR
  const pyramid = buildHizPyramid(depth, 5, 5)
  assert.equal(pyramid.data[pyramid.offsets[pyramid.count - 1]], DEPTH_CLEAR)
  const data = pyramid.data
  const again = buildHizPyramid(new Float32Array(25).fill(0.9), 5, 5, pyramid)
  assert.equal(again, pyramid)
  assert.equal(again.data, data)
  assert.equal(again.data[again.offsets[again.count - 1]], Math.fround(0.9))
})

test('a depth too short for the viewport, or an empty viewport, is refused', () => {
  assert.throws(() => buildHizPyramid(new Float32Array(3), 2, 2), /HIZ_DEPTH_SIZE/)
  assert.throws(() => buildHizPyramid(new Float32Array(4), 0, 4), /HIZ_DEPTH_SIZE/)
  assert.throws(() => buildHizPyramid(new Float32Array(4), 4, 0), /HIZ_DEPTH_SIZE/)
})
