// The shadow maps' software raster (`renderSoftwareWgsl.ts`): which clusters each map's view hands
// it, the records' windows it and the hardware raster draw, and its setup, the camera's own. Split
// from `../rasterSkips.test.ts` by subject, as the bound on a test file's lines asks.

import { mulberry32 } from '../../../../../../math/src/sequence/random.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf, wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'

import { vsmRenderCullWgsl } from '../render/renderCullWgsl.ts'

import {
  VSM_RENDER_RECORD_WGSL,
  VSM_RENDER_WINDOW_PAGES,
  VSM_RENDER_WINDOW_PAGES_SOFTWARE,
} from '../render/renderParamsWgsl.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'

import { vsmRenderRasterWgsl } from '../render/renderRasterWgsl.ts'
import { VSM_LEVEL0_TEXELS, VSM_PAGE_TEXELS } from '../constants.ts'
import { vsmRenderSoftwareWgsl } from '../render/renderSoftwareWgsl.ts'
import { vsmSoftwarePipes } from './renderPipes.ts'
import { storageBufferCount } from '../../../../gpu/core/stageLimits.fixture.ts'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'

import { rasterSource } from '../../../../visibility/raster/shader.ts'
import { SUBPIXEL_SAMPLES } from '../../../../visibility/raster/contract.ts'

import { Mat } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'
import { wgslSource } from '../../../../../../math/src/wgsl/source.fixture.ts'
import { SUNS_LAYOUT } from '../layout.fixture.ts'

const LAYOUT = SUNS_LAYOUT
const CULL = vsmRenderCullWgsl(LAYOUT)
const CODE = vsmRenderRasterWgsl(LAYOUT)

// Each map's mip view picks a cluster's raster by the camera's rule: its longest edge spanning no more than `hardwareEdge` pixels at the nearest point of its
// level of detail's sphere — its whole sphere where its vertices move — is the software raster's,
// unless its box crosses the near or the far plane, it is tessellated or a voxel row, its edge is
// unknown or the software raster is off. A view 200 pixels a unit at depth one, a cluster 10 units
// ahead: its unit edge spans 23.6 pixels at its own sphere (radius 0.5), 70.7 at its whole (5); the
// cull hands the verdict the edge scale of the sphere it judges (`vsmRenderEdgeScale`) and the mip's
// pixels per unit, multiplied out.
test('a map’s view hands the clusters small in its pixels to the software raster, the camera’s rule', () => {
  const C = wgslConstants(CULL)
  const run = (hardwareEdge: number) =>
    shaderRun<{ vsmRenderSoftware(...a: unknown[]): boolean }>(CULL, ['vsmRenderSoftware'], {
      ...C,
      params: { hardwareEdge },
    }).vsmRenderSoftware
  const { vsmRenderEdgeScale } = shaderRun<{ vsmRenderEdgeScale(...a: unknown[]): number }>(
    CULL,
    ['vsmRenderEdgeScale'],
    C,
  )
  // Clip w = −z: the view's position is the clip's x, y over the projection's scale, and −w.
  const perspective = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0])
  const lens = { focal: 200, near: 0.1, perspective: true }
  const scaleOf = (radius: number) =>
    vsmRenderEdgeScale([0, 0, -10], radius, perspective, perspective, lens)
  const cand = (edge: number, flags = 0, corners = 3) => ({
    ...{ c: [0, 0, 0, 5], l: [0, 0, 0], row: 0, corners, flags, farDepth: 0 },
    ...{ own: [0, 0, 0, 0.5], parent: [0, 0, 0, 1], errors: [0, 0], prevShift: [0, 0, 0], edge },
  })
  const inside = { pastNear: false, pastFar: false }
  const software = (
    c: { flags: number },
    { edge = 32, cull = inside, tessellated = false }: Record<string, unknown> = {},
  ) =>
    run(edge as number)(
      c,
      // The sphere the cull judges: the whole one where the vertices move, else the level of detail's.
      scaleOf(c.flags & C.VSM_RENDER_CAND_MOVING! ? 5 : 0.5),
      lens.focal,
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
  // A ball wholly behind the near plane has no scale: the hardware raster's.
  assert.equal(run(32)(cand(1), 0, lens.focal, inside, false), false, 'no scale')
})

// A record draws a window of up to four pages a side (the reference's raster window,
// `VSM_RENDER_WINDOW_PAGES`; eight for the software raster), its rect clipped to the pages that
// matter: the raster places the window's first page at the viewport's corner and draws every page of
// the rect, which the extent it carries (`vsmRecordExtent`) bounds.
test('a record’s window: its rect of pages, its first page at the viewport’s corner', () => {
  const record = [0, 0, (10 | (20 << 8) | (12 << 16) | (21 << 24)) >>> 0, 0]
  const { vsmRecordExtent, vsmExtentPages } = shaderRun<{
    vsmRecordExtent(r: number[]): number
    vsmExtentPages(extent: number): number[]
  }>(VSM_RENDER_RECORD_WGSL, ['vsmRecordExtent', 'vsmExtentPages'], {})
  assert.deepEqual(vsmExtentPages(vsmRecordExtent(record)), [2, 1], 'two pages past the first, one')
  const { vsmRenderWindowPosition } = shaderRun<{
    vsmRenderWindowPosition(clip: number[], r: number[]): number[]
  }>(CODE, ['vsmRenderWindowPosition'], wgslConstants(CODE))
  const at = (u: number, v: number) => vsmRenderWindowPosition([u, v, 0.5, 1], record)
  assert.deepEqual(at(1280 / 16384, 2560 / 16384), [-1, 1, 0.5, 1], 'page (10, 20) at the corner')
  assert.deepEqual(at(1792 / 16384, 3072 / 16384), [1, -1, 0.5, 1], 'four pages on, the other')
})

// The software raster of the small clusters (`render/renderSoftwareWgsl.ts`) is the camera's one
// cluster raster (`clusterRasterKernels`): its setup and pixel walks, word for word, on a frame of
// its window (`rasterViewport`, eight pages a side). A corner it places lands on the texel the
// hardware raster's window places it on.
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
    const sw = subpixelOf(vsmRenderWindowAt(clip, record, VSM_RENDER_WINDOW_PAGES_SOFTWARE))
    const swPixel = [sw[0], sw[1]].map((v) => v / SUBPIXEL_SAMPLES)
    for (let a = 0; a < 2; a++) {
      assert.ok(Math.abs(swPixel[a] - hwPixel[a]) <= 1 / SUBPIXEL_SAMPLES + 1e-3, `${k} ${a}`)
      assert.ok(Math.abs(hwPixel[a] - (at[a] - page[a] * VSM_PAGE_TEXELS)) < 1e-2, `${k} ${a}`)
    }
  }
})

// A group reads the pages of its record's window from the page table, at the index the bin put in the
// record and a row of the table apart as the hardware raster reads them (`vsmRenderPageOrigin`, which
// the hardware fragment shares), into the memory it keeps them in (the reference's page table cache); a
// page that is not one to draw at its level is none.
test('the software raster reads each page of its window from the page table by the record’s index', () => {
  const shadow = vsmRenderSoftwareWgsl(LAYOUT)
  const stride = 128
  // Page (2, 1) of the table; a window of three pages by two.
  const first = stride + 2
  const table = new Map<number, number>()
  const word = (x: number, y: number, drawable = true) => x | (y << 8) | (drawable ? 1 << 16 : 0)
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 3; x++)
      table.set(first + y * stride + x, word(x + 4, y + 9, x !== 2 || y !== 1))
  const { vsmRenderPageOrigin } = shaderRun<{
    vsmRenderPageOrigin(first: number, local: number[]): number
  }>(shadow, ['vsmRenderPageOrigin'], {
    ...wgslConstants(shadow),
    vsm: { pageTableSize: [stride, 192] },
    vsmPageTableLoad: (index: number) => table.get(index) ?? 0,
    vsmUnpackTableEntry: (w: number) => ({
      physicalAddress: [w & 0xff, (w >> 8) & 0xff],
      thisLevelDrawable: (w & (1 << 16)) !== 0,
    }),
  })
  const none = 0xffffffff
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((i) => vsmRenderPageOrigin(first, [i % 3, Math.floor(i / 3)])),
    [4 | (9 << 16), 5 | (9 << 16), 6 | (9 << 16), 4 | (10 << 16), 5 | (10 << 16), none],
    'row by row, the last page not one to draw',
  )
})

// The corners of a record are placed by the view of its map: the shifted-to-map matrix, the origin
// shift and the offsets' threshold, as the hardware raster reads them of the map's record. On a device
// with a ninth storage buffer the stage reads the record itself; on one without, the view the bin laid
// in the sorted list after its counts, a pass's first map first. The same fields either way.
test('the software raster reads the view of its record’s map from the record, or from the sorted list', () => {
  const laid = vsmRenderSoftwareWgsl(LAYOUT)
  const bound = vsmRenderSoftwareWgsl(LAYOUT, undefined, undefined, false, true)
  const K = wgslConstants(laid)
  const capacity = 10,
    first = 2
  const floats = new Float32Array(4 * K.VSM_RENDER_SOFTWARE_VIEW_RECORDS!)
  const matrix = Array.from({ length: 16 }, (_, i) => i + 1)
  floats.set(matrix)
  floats.set([0.5, 1.5, 2.5, 0.25], 16)
  floats.set([-1, -2, -3, 0], 20)
  const bits = new Uint32Array(floats.buffer)
  // The map 4 is the pass's third: its view lies two views past the counts' word.
  const list = Array.from(
    { length: capacity + 1 + 3 * K.VSM_RENDER_SOFTWARE_VIEW_RECORDS! },
    () => [0, 0, 0, 0],
  )
  const at = capacity + 1 + 2 * K.VSM_RENDER_SOFTWARE_VIEW_RECORDS!
  for (let k = 0; k < K.VSM_RENDER_SOFTWARE_VIEW_RECORDS!; k++)
    list[at + k] = [...bits.slice(4 * k, 4 * k + 4)]
  type View = {
    shiftedToMapUv: { m: number[] }
    originShiftHigh: number[]
    originShiftLow: number[]
    wpoThreshold: number
  }
  const viewFrom = shaderRun<{ vsmSoftwareView(map: number): View }>(laid, ['vsmSoftwareView'], {
    ...K,
    vsmSoftwareRecords: list,
    params: { recordCapacity: capacity, viewFirst: first },
  }).vsmSoftwareView
  const record = {
    ...{ shiftedToMapUv: new Mat(matrix), wpoThreshold: 0.25 },
    ...{ originShiftHigh: [0.5, 1.5, 2.5], originShiftLow: [-1, -2, -3] },
  }
  const recordFrom = shaderRun<{ vsmSoftwareView(map: number): View }>(bound, ['vsmSoftwareView'], {
    ...wgslConstants(bound),
    vsmProjectionData: [0, 0, 0, 0, record],
  }).vsmSoftwareView
  for (const raw of [viewFrom(4), recordFrom(4)]) {
    assert.deepEqual(raw.shiftedToMapUv.m, matrix)
    assert.deepEqual([...raw.originShiftHigh], [0.5, 1.5, 2.5])
    assert.equal(raw.wpoThreshold, 0.25)
    assert.deepEqual([...raw.originShiftLow], [-1, -2, -3])
  }
  // The bound text lays no view, and the laid one binds no projection data.
  assert.doesNotMatch(wgslSource(bound), /vsmSoftwareViewAt/)
  assert.doesNotMatch(wgslSource(laid), /vsmProjectionData/)
})

// The stage holds the eight storage buffers every device has: the page rows' five, the sorted records,
// the page table and the pool's slice. A device with a ninth binds the second slice too and rasters
// both layers in one kernel; one with a tenth, the projection data as well.
test('each software kernel binds eight storage buffers, nine or ten where the device has them', () => {
  for (const [limit, count] of [
    [8, 8],
    [9, 9],
    [10, 10],
  ] as const) {
    const fake = fakeDevice({ limits: { maxStorageBuffersPerShaderStage: limit } })
    const pipes = vsmSoftwarePipes(fake.device, LAYOUT)
    // The one kernel of both layers where the device grants the second slice; else one a layer.
    assert.equal('static' in pipes, limit === 8)
    for (const pipe of [pipes.all, pipes.static].filter((pipe) => pipe))
      assert.equal(storageBufferCount({ bindGroupLayouts: pipe!.groups }), count)
  }
})
