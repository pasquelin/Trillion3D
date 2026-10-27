// The shadow maps' software raster (`renderSoftwareWgsl.ts`): which clusters each map's view hands
// it, the records' windows it and the hardware raster draw, and its setup, the camera's own. Split
// from `../rasterSkips.test.ts` by subject, as the bound on a test file's lines asks.

import { mulberry32 } from '../../../../../../math/src/sequence/random.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf, wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'

import { vsmRenderCullWgsl } from '../render/renderCullWgsl.ts'

import { VSM_RENDER_RECORD_WGSL, VSM_RENDER_WINDOW_PAGES } from '../render/renderParamsWgsl.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'

import { vsmRenderRasterWgsl } from '../render/renderRasterWgsl.ts'
import { vsmLayout } from '../layout.ts'
import { VSM_LEVEL0_TEXELS, VSM_PAGE_TEXELS } from '../constants.ts'
import { vsmRenderSoftwareWgsl } from '../render/renderSoftwareWgsl.ts'

import { rasterSource } from '../../../../visibility/raster/shader.ts'
import { SUBPIXEL_SAMPLES } from '../../../../visibility/raster/contract.ts'

import { Mat } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'

const LAYOUT = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 })
const CULL = vsmRenderCullWgsl(LAYOUT)
const CODE = vsmRenderRasterWgsl(LAYOUT)

// Each map's mip view picks a cluster's raster by the camera's rule: its longest edge spanning no more than `hardwareEdge` pixels at the nearest point of its
// level of detail's sphere — its whole sphere where its vertices move — is the software raster's,
// unless its box crosses the near or the far plane, it is tessellated or a voxel row, its edge is
// unknown or the software raster is off. A view 200 pixels a unit at depth one, a cluster 10 units
// ahead: its unit edge spans 23.6 pixels at its own sphere (radius 0.5), 70.7 at its whole (5).
test('a map’s view hands the clusters small in its pixels to the software raster, the camera’s rule', () => {
  const C = wgslConstants(CULL)
  const run = (hardwareEdge: number) =>
    shaderRun<{ vsmRenderSoftware(...a: unknown[]): boolean }>(CULL, ['vsmRenderSoftware'], {
      ...C,
      params: { hardwareEdge },
    }).vsmRenderSoftware
  // Clip w = −z: the view's position is the clip's x, y over the projection's scale, and −w.
  const perspective = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0])
  const cand = (edge: number, flags = 0, corners = 3) => ({
    ...{ c: [0, 0, 0, 5], l: [0, 0, 0], row: 0, corners, flags, farDepth: 0 },
    ...{ own: [0, 0, 0, 0.5], parent: [0, 0, 0, 1], errors: [0, 0], prevShift: [0, 0, 0], edge },
  })
  const inside = { pastNear: false, pastFar: false }
  const software = (
    c: object,
    { edge = 32, cull = inside, tessellated = false }: Record<string, unknown> = {},
  ) =>
    run(edge as number)(
      c,
      [0, 0, -10],
      perspective,
      perspective,
      { focal: 200, near: 0.1, perspective: true },
      cull,
      tessellated,
    )
  assert.equal(software(cand(1)), true, '23.6 pixels: the software raster')
  assert.equal(software(cand(1), { edge: 20 }), false, 'past a 20-pixel edge: the hardware')
  assert.equal(software(cand(1, C.VSM_RENDER_CAND_MOVING)), false, 'moving: its whole sphere')
  assert.equal(software(cand(1), { edge: 0 }), false, 'the software raster off')
  assert.equal(software(cand(0)), false, 'its edge unknown')
  assert.equal(software(cand(1, 0, 3 | C.VSM_RENDER_VOXEL_BIT)), false, 'a voxel row')
  assert.equal(software(cand(1), { tessellated: true }), false, 'tessellated')
  for (const cull of [
    { pastNear: true, pastFar: false },
    { pastNear: false, pastFar: true },
  ])
    assert.equal(software(cand(1), { cull }), false, 'across the near or the far plane')
})

// A record draws a window of up to four pages a side (the reference's raster window,
// `VSM_RENDER_WINDOW_PAGES`), its pages in a mask: the raster places the window's first page at the
// viewport's corner and draws the pages of the mask alone.
test('a record’s window: its pages in the mask, its first page at the viewport’s corner', () => {
  const record = [0, 0, (10 | (20 << 8) | (12 << 16) | (21 << 24)) >>> 0, 0b100101]
  const { vsmRecordDrawsPage } = shaderRun<{
    vsmRecordDrawsPage(r: number[], p: number[]): boolean
  }>(VSM_RENDER_RECORD_WGSL, ['vsmRecordDrawsPage'], {})
  assert.deepEqual(
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 1],
      [3, 0],
      [0, 1],
    ].map((p) => vsmRecordDrawsPage(record, p)),
    [true, false, true, true, false, false],
  )
  const { vsmRenderWindowPosition } = shaderRun<{
    vsmRenderWindowPosition(clip: number[], r: number[]): number[]
  }>(CODE, ['vsmRenderWindowPosition'], wgslConstants(CODE))
  const at = (u: number, v: number) => vsmRenderWindowPosition([u, v, 0.5, 1], record)
  assert.deepEqual(at(1280 / 16384, 2560 / 16384), [-1, 1, 0.5, 1], 'page (10, 20) at the corner')
  assert.deepEqual(at(1792 / 16384, 3072 / 16384), [1, -1, 0.5, 1], 'four pages on, the other')
})

// The software raster of the small clusters (`render/renderSoftwareWgsl.ts`) is the camera's one
// cluster raster (`clusterRasterKernels`): its setup and pixel walks, word for word, on a frame of
// one page (`rasterViewport`), its record's window that page. A
// corner it places lands on the texel the hardware raster's window places it on.
test('the shadow maps’ software raster is the camera’s, its corners on the texels of the hardware window', () => {
  const shadow = vsmRenderSoftwareWgsl(LAYOUT)
  const camera = rasterSource()
  for (const name of ['setupSubpixel', 'rasterRect', 'rasterScanline'])
    assert.equal(functionsOf(shadow, [name]), functionsOf(camera, [name]), name)
  const { subpixelOf, vsmRenderWindowAt } = shaderRun<{
    subpixelOf(clip: number[]): number[]
    vsmRenderWindowAt(clip: number[], r: number[], side: number): number[]
  }>(shadow, ['subpixelOf', 'vsmRenderWindowAt'], wgslConstants(shadow))
  const { vsmRenderWindowPosition } = shaderRun<{
    vsmRenderWindowPosition(clip: number[], r: number[]): number[]
  }>(CODE, ['vsmRenderWindowPosition'], wgslConstants(CODE))
  const side = VSM_RENDER_WINDOW_PAGES * VSM_PAGE_TEXELS
  const random = mulberry32(7)
  for (let k = 0; k < 64; k++) {
    // Mip 2 (32 pages a side), the record's first page at (7, 20): a point within it, at w = 2.
    const mip = 2,
      page = [7, 20]
    const record = [0, mip << 16, (page[0] | (page[1] << 8)) >>> 0, 1]
    const texels = VSM_LEVEL0_TEXELS >> mip
    const at = page.map((p) => (p + random()) * VSM_PAGE_TEXELS)
    const w = 2
    // The map's clip position: its texel over the level's side, y down (\`vsmRenderClip\`).
    const clip = [(at[0] / texels) * w, (at[1] / texels) * w, 0.5 * w, w]
    const hw = vsmRenderWindowPosition(clip, record)
    const hwPixel = [(hw[0] / hw[3]) * 0.5 + 0.5, 0.5 - (hw[1] / hw[3]) * 0.5].map((v) => v * side)
    const sw = subpixelOf(vsmRenderWindowAt(clip, record, 1))
    const swPixel = [sw[0], sw[1]].map((v) => v / SUBPIXEL_SAMPLES)
    for (let a = 0; a < 2; a++) {
      assert.ok(Math.abs(swPixel[a] - hwPixel[a]) <= 1 / SUBPIXEL_SAMPLES + 1e-3, `${k} ${a}`)
      assert.ok(Math.abs(hwPixel[a] - (at[a] - page[a] * VSM_PAGE_TEXELS)) < 1e-2, `${k} ${a}`)
    }
  }
})
