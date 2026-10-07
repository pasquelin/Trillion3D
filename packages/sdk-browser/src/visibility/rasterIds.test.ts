// The CPU visbuffer oracle's identifiers, on a cut of several pages, a widened line page and a
// masked page: what a host and a bench read of the image the GPU rasters are compared to.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { camera, quadPages } from './buffer.fixture.ts'
import { createEngineCamera, readCameraWorld } from '../camera/world.ts'
import { surfaceOf } from '../page/surface.ts'
import { identityRoots } from '../page/selection/placements.fixture.ts'
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
