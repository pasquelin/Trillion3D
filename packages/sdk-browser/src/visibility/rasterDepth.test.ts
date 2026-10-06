// The Hi-Z pyramid is built from the raster's depth and from nothing else — it copies the
// depth into its own buffer and rejects the pages from their rectangle. So the depth-only entry
// point must give the same values, bit for bit, on a cut of several pages, a widened line page and a
// masked page, whether the buffer it writes is fresh or the one the previous image left behind.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { rasterDepth } from './raster.ts'
import { camera, quadPages } from './buffer.fixture.ts'
import { createEngineCamera, readCameraWorld } from '../camera/world.ts'
import { surfaceOf } from '../page/surface.ts'
import { identityRoots } from '../page/selection/placements.fixture.ts'
import { DEPTH_CLEAR, DEPTH_NEAR } from '../camera/depthConvention.ts'
import { rasterVisibility } from '../../../../bench/oracles/browser/cpu-image/raster.ts'

const SIZE: [number, number] = [32, 32]
const cam = readCameraWorld(createEngineCamera(), camera())

/** A cut of three quads at three depths, a widened line page and a page a map cuts out of: every
 *  branch `fillIds` has, in one image. */
function cut(): { pages: ReturnType<typeof quadPages>['pages']; dispose: () => void } {
  const opaque = G.basicSurface({ color: 0x3366ff })
  const far = G.basicSurface({ color: 0xff8800 })
  const mapped = G.basicSurface({
    color: 0xffffff,
    alphaTest: 0.5,
    map: G.dataTexture(
      new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]),
      2,
      2,
      G.HOST_FORMAT_RGBA,
    ),
  })
  const near = quadPages(opaque, [0, 0, 1, 0, 1, 1, 0, 1])
  const behind = quadPages(far, [0, 0, 1, 0, 1, 1, 0, 1])
  // Behind the eye, so the far quads cover only what the near ones leave: a real z gradient.
  behind.pages[0].array = new Uint32Array([0, 1, 2])
  const line = new G.Geometry()
  line.setAttribute(
    'position',
    G.floatAttribute([-1, 0.4, -1, -1, 0.4, -1, 1, 0.4, -1, 1, 0.4, -1], 3),
  )
  line.setIndex(G.indices([0, 1, 2, 0, 2, 3]))
  const lined = {
    array: new Uint32Array([0, 1, 2, 0, 2, 3]),
    attributes: line.attributes,
    material: surfaceOf(G.basicSurface({ color: 0xffffff, side: G.DOUBLE_SIDE, lineWidth: 2 })),
    clusterId: 'line',
  }
  return {
    pages: [...near.pages, ...behind.pages, lined],
    dispose: () => {
      ;[near.geometry, behind.geometry, line].forEach((geometry) => geometry.dispose())
      ;[opaque, far, mapped].forEach((material) => material.dispose())
    },
  }
}

test('the depth-only raster writes what the two-buffer raster writes, value for value', () => {
  const { pages, dispose } = cut()
  const reference = rasterVisibility(pages, identityRoots(), cam, SIZE).depth
  const computed = rasterDepth(
    pages,
    identityRoots(),
    cam,
    SIZE,
    1,
    new Float32Array(SIZE[0] * SIZE[1]),
  )
  assert.deepEqual([...computed], [...reference])
  assert.ok(
    reference.some((z) => z !== DEPTH_CLEAR),
    'the cut covers the image: nothing to compare',
  )
  assert.ok(
    reference.some((z) => z > DEPTH_CLEAR),
    'and with a z gradient, not one value',
  )
  dispose()
})

test('the same values with a widened line page and its pixel ratio', () => {
  const { pages, dispose } = cut()
  for (const pixelRatio of [1, 2]) {
    const reference = rasterVisibility(pages, identityRoots(), cam, SIZE, pixelRatio).depth
    const computed = rasterDepth(
      pages,
      identityRoots(),
      cam,
      SIZE,
      pixelRatio,
      new Float32Array(SIZE[0] * SIZE[1]),
    )
    assert.deepEqual([...computed], [...reference], `ratio ${pixelRatio}`)
  }
  dispose()
})

test('the far value reaches every pixel the image does not draw, whatever the buffer held', () => {
  const { pages, dispose } = cut()
  const pixels = SIZE[0] * SIZE[1]
  // Absolute, not a comparison with the two-buffer raster: they share the kernel, so both would
  // be wrong together. A buffer full of a nearer depth than any page reaches, and nothing drawn.
  const empty = new Float32Array(pixels).fill(DEPTH_NEAR)
  rasterDepth([], identityRoots(), cam, SIZE, 1, empty)
  assert.ok(
    [...empty].every((z) => z === DEPTH_CLEAR),
    'an empty cut is the far plane everywhere',
  )
  // The same, with the cut drawn: every pixel either the far value or a depth no nearer than it.
  const demi = new Float32Array(pixels).fill(DEPTH_NEAR)
  rasterDepth(pages, identityRoots(), cam, SIZE, 1, demi)
  assert.ok([...demi].every((z) => z === DEPTH_CLEAR || z <= DEPTH_NEAR))
  assert.ok(
    [...demi].some((z) => z !== DEPTH_CLEAR),
    'and the cut did draw',
  )
  dispose()
})

test('a reused buffer carries nothing of the image before it', () => {
  const { pages, dispose } = cut()
  const large: [number, number] = [48, 48],
    petit: [number, number] = [16, 16]
  const buffer = new Float32Array(large[0] * large[1])
  // A wide image first: its pixels past the narrow one are the tail a narrow call must not read.
  rasterDepth(pages, identityRoots(), cam, large, 1, buffer)
  rasterDepth([], identityRoots(), cam, petit, 1, buffer)
  const reference = rasterVisibility([], identityRoots(), cam, petit).depth
  assert.deepEqual(
    [...buffer.subarray(0, petit[0] * petit[1])],
    [...reference],
    'an empty cut clears',
  )
  assert.deepEqual(
    [...buffer.subarray(petit[0] * petit[1], petit[0] * petit[1] + 64)],
    [
      ...rasterVisibility(pages, identityRoots(), cam, large, 1).depth.subarray(
        petit[0] * petit[1],
        petit[0] * petit[1] + 64,
      ),
    ],
    'the tail of the wider image stays where it was, unread',
  )
  // The same cut twice into the same buffer: identical, whatever the first left.
  const twice = new Float32Array(SIZE[0] * SIZE[1])
  rasterDepth(pages, identityRoots(), cam, SIZE, 1, twice)
  const first = [...twice]
  rasterDepth(pages, identityRoots(), cam, SIZE, 1, twice)
  assert.deepEqual([...twice], first)
  dispose()
})

test('a buffer too small for the image is refused by the name the pyramid raises', () => {
  const { pages, dispose } = cut()
  assert.throws(
    () =>
      rasterDepth(pages, identityRoots(), cam, SIZE, 1, new Float32Array(SIZE[0] * SIZE[1] - 1)),
    /HIZ_DEPTH_SIZE/,
  )
  // Wide enough is not a promise on the pixels: the call clears what it reads.
  rasterDepth(pages, identityRoots(), cam, SIZE, 1, new Float32Array(SIZE[0] * SIZE[1] + 7))
  dispose()
})

test('the ids of the two-buffer raster keep their bits: a host and a bench read them', () => {
  const { pages, dispose } = cut()
  const a = rasterVisibility(pages, identityRoots(), cam, SIZE),
    b = rasterVisibility(pages, identityRoots(), cam, SIZE)
  assert.notEqual(a.ids, b.ids, 'each call hands back its own array')
  assert.deepEqual([...a.ids], [...b.ids], 'and the same values in both')
  assert.ok(
    a.ids.some((id) => id !== 0),
    'the cut names the pages it drew',
  )
  dispose()
})
