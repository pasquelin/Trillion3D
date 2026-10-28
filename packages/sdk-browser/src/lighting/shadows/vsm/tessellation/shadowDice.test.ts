// The shadow maps' software raster of the patches (`shadowDiceWgsl.ts`, `shadowWindowWgsl.ts`): what it binds,
// that it rasters with the casters' own functions, and that a micro-triangle it rasters covers the texels
// a CPU reference covers, through the pages of its window, at the depth of its plane.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { functionsOf, wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { SUBPIXEL_SAMPLES } from '../../../../visibility/raster/contract.ts'
import { FLAG_DOUBLE } from '../../../../visibility/types.ts'
import { TESS_PROGRAMS, tessLayoutEntries } from '../../../../visibility/tessellation/bindings.ts'
import {
  ARG_VISIBLE,
  ARG_VISIBLE_STATIC,
  VISIBLE_LISTS,
  WINDOW_LENS_AT,
  WINDOW_PAGE_SLOTS,
  WINDOW_POOL_AT,
  WINDOW_VIEW_AT,
  WINDOW_VIEW_RECORDS,
  WINDOW_VIEW_WORDS,
  WINDOW_WORDS,
} from '../../../../visibility/tessellation/contract.ts'
import { wgslBindingNumbers } from '../../../../gpu/core/wgslBindings.fixture.ts'
import { WORKGROUP_THREADS } from '../../../../gpu/dispatch/grid.ts'
import { shadowPageComputeEntries } from '../../casters/pageGroup.ts'
import { VSM_PAGE_TEXELS } from '../constants.ts'
import { SUNS_LAYOUT } from '../layout.fixture.ts'
import { VSM_RENDER_SOFTWARE_VIEW_RECORDS } from '../render/renderParamsWgsl.ts'
import { vsmRenderSoftwareWgsl } from '../render/renderSoftwareWgsl.ts'
import { VSM_SOFTWARE_SLOTS } from '../render/windowRasterWgsl.ts'
import { vsmBindGroupLayoutEntries } from '../resources.ts'
import {
  DICE_LAYERS,
  VSM_TESS_DICE_POOL_GROUP,
  VSM_TESS_DICE_SPECS,
  VSM_TESS_DICE_TESS_GROUP,
  vsmTessDiceWgsl,
} from './shadowDiceWgsl.ts'
import { VSM_WINDOW_SPECS, vsmWindowFillSource } from './shadowWindowWgsl.ts'

const DICE = vsmTessDiceWgsl(SUNS_LAYOUT)

test('the dicing declares what it reads in the groups its layouts list, and binds the eight storage buffers every device holds', () => {
  const device = fakeDevice().device as unknown as GPUDevice
  const bindings = (entries: GPUBindGroupLayoutEntry[]) =>
    entries.map((entry) => entry.binding).sort((a, b) => a - b)
  const page = shadowPageComputeEntries(device)
  // Group 0 is the page group’s compute twin: the dicing reads a subset of it; the others are declared whole.
  assert.ok(wgslBindingNumbers(DICE, 0).every((binding) => bindings(page).includes(binding)))
  assert.deepEqual(
    wgslBindingNumbers(DICE, VSM_TESS_DICE_TESS_GROUP),
    bindings(tessLayoutEntries('shadowDice')),
  )
  assert.deepEqual(
    wgslBindingNumbers(DICE, VSM_TESS_DICE_POOL_GROUP),
    bindings(vsmBindGroupLayoutEntries(VSM_TESS_DICE_SPECS, 4)),
  )
  const storage = (entries: GPUBindGroupLayoutEntry[]) =>
    entries.filter((e) => e.buffer && e.buffer.type !== 'uniform').length
  assert.equal(
    storage(page) +
      storage(tessLayoutEntries('shadowDice')) +
      storage(vsmBindGroupLayoutEntries(VSM_TESS_DICE_SPECS, 4)),
    8,
    'five page rows, tess and the data atlas’s page table, the pool’s slice',
  )
  // Every storage buffer the text declares is one of those eight.
  assert.equal((DICE.match(/var<storage/g) ?? []).length, 8)
  // The records, the maps’ projections and the page table are read from the windows, not bound.
  assert.doesNotMatch(DICE, /vsmProjectionData|vsmPageTableLoad|vsmTessRecords/)
  // The windows’ fill declares its groups whole.
  const fill = vsmWindowFillSource(SUNS_LAYOUT)
  assert.deepEqual(wgslBindingNumbers(fill, 0), bindings(tessLayoutEntries('shadowWindow')))
  assert.deepEqual(
    wgslBindingNumbers(fill, 1),
    bindings(vsmBindGroupLayoutEntries(VSM_WINDOW_SPECS, 4)),
  )
  assert.ok(
    TESS_PROGRAMS.shadowDice.every((name) => name !== 'sampler'),
    'the sampler is the page group’s',
  )
})

test('a window holds the record, the map’s view, the mip’s lens and the pool origin of each page of the record’s window, one a lane of the group', () => {
  assert.equal(WINDOW_PAGE_SLOTS, VSM_SOFTWARE_SLOTS, 'the pages of the casters’ window')
  assert.equal(WINDOW_PAGE_SLOTS, WORKGROUP_THREADS, 'a lane a page')
  assert.equal(WINDOW_VIEW_RECORDS, VSM_RENDER_SOFTWARE_VIEW_RECORDS)
  assert.equal(WINDOW_VIEW_WORDS, 4 * (VSM_RENDER_SOFTWARE_VIEW_RECORDS + 1))
  assert.equal(WINDOW_LENS_AT, WINDOW_VIEW_AT + 4 * VSM_RENDER_SOFTWARE_VIEW_RECORDS)
  assert.equal(WINDOW_WORDS, WINDOW_POOL_AT + WINDOW_PAGE_SLOTS)
})

test('a shadow map’s dicing cuts a micro-triangle by the near plane where its map has one, keeps it whole where it has none, and lists a layer in a run of its own', () => {
  // Only the target that cuts holds the clip positions and the cut; a map with a near clip is cut, one with none keeps what is before it.
  assert.match(DICE, /var<workgroup> clipOf/)
  assert.match(DICE, /fn diceNear\(/)
  assert.match(
    DICE,
    /if\(item\.near==1u&&\(clipOf\[c\.x\]\.w<clipOf\[c\.x\]\.z\|\|clipOf\[c\.y\]\.w<clipOf\[c\.y\]\.z\|\|clipOf\[c\.z\]\.w<clipOf\[c\.z\]\.z\)\)\{diceNear\(/,
    'cut only a micro-triangle with a corner short of the plane',
  )
  assert.match(DICE, /select\(1u,2u,vsmRecordNoNearClip\(diceRecord\)\)/)
  // The layers: one entry point and one dispatch word each, the dynamic layer's patches counted by the first counter and kept from the start of the
  // visible region, the static layer's by the second and from its end.
  assert.deepEqual(
    DICE_LAYERS.map(({ entry }) => entry),
    ['vsmTessDice0', 'vsmTessDice1'],
  )
  for (const { entry } of DICE_LAYERS) assert.match(DICE, new RegExp(`fn ${entry}\\(`))
  assert.deepEqual(
    VISIBLE_LISTS.map(({ counter }) => counter),
    [ARG_VISIBLE, ARG_VISIBLE_STATIC],
  )
  assert.match(DICE, /fn listCounter\(layer:u32\)->u32\{return select\(1u,7u,layer==1u\);\}/)
  assert.match(
    DICE,
    /fn listSlot\(layer:u32,i:u32\)->u32\{return select\(i,tu\.maxVisible-1u-i,layer==1u\);\}/,
  )
})

test('the dicing rasters with the casters’ own functions: their setup, their box walk, their page translation and depth write', () => {
  const caster = vsmRenderSoftwareWgsl(SUNS_LAYOUT)
  for (const name of [
    'setupSubpixel',
    'rasterRect',
    'subpixelOf',
    'vsmSoftwarePlace',
    'vsmSoftwareSides',
  ])
    assert.equal(functionsOf(DICE, [name]), functionsOf(caster, [name]), name)
  // The pixel write is the casters’ own, text for text; what differs is the cutout, which the casters judge at the pixel
  // (`pixelKeeps`) and the patches at their vertices.
  assert.equal(functionsOf(DICE, ['writePixel']), functionsOf(caster, ['writePixel']))
  assert.doesNotMatch(functionsOf(DICE, ['pixelKeeps']), /maskKeep|triCutout/)
  assert.match(functionsOf(caster, ['pixelKeeps']), /maskKeep/)
})

test('a micro-triangle is rastered on the texels a CPU reference covers: its pixels, through the pages of the window, at the depth of its plane', () => {
  const S = SUBPIXEL_SAMPLES
  const NONE = 0xffffffff
  // The window’s table of origins: page (0, 0) is the pool page (3, 5), page (1, 0) none, page (2, 0) (7, 2).
  const pool = Array.from({ length: VSM_SOFTWARE_SLOTS }, () => NONE)
  pool[0] = 3 | (5 << 16)
  pool[2] = 7 | (2 << 16)
  const written = new Map<string, number>()
  const run = shaderRun<{
    setupSubpixel(start: object, page: object, det: number, ...s: number[][]): { ok: number }
    rasterRect(t: object, mode: number): void
  }>(DICE, ['setupSubpixel', 'rasterRect'], {
    ...wgslConstants(DICE),
    swPool: pool,
    vsmPoolAtomicMax: (texel: number[], slice: number, depth: number) => {
      const key = `${texel[0]},${texel[1]}`
      written.set(key, Math.max(written.get(key) ?? 0, depth))
      assert.equal(slice, 0)
    },
  })
  const start = {
    ...{ minPixel: [0, 0], maxPixel: [0, 0], e01: [0, 0], e12: [0, 0], e20: [0, 0] },
    ...{ c: [0, 0, 0], depth: [0, 0, 0], invW: [0, 0, 0], dx: [0, 0, 0], dy: [0, 0, 0] },
    ...{ ua: [0, 0, 0], ub: [0, 0, 0], uc: [0, 0, 0], corners: [0, 0, 0] },
    ...{ row: 0, triangle: 0, ok: 0 },
  }
  // A triangle of the window’s pixels, at odd fractions so that no pixel centre lies on an edge, over the
  // pages 0 and 1 and again 1 and 2; its depths differ per corner.
  const side = VSM_PAGE_TEXELS
  const cases = [
    [
      [100.3, 10.2, 0.25],
      [160.7, 14.9, 0.5],
      [118.4, 40.6, 0.75],
    ],
    [
      [250.3, 60.2, 0.3],
      [300.7, 66.9, 0.6],
      [270.4, 96.6, 0.9],
    ],
  ]
  for (const corners of cases) {
    written.clear()
    const snapped = corners.map(([x, y, z]) => [
      Math.floor(x! * S + 0.5),
      Math.floor(y! * S + 0.5),
      z!,
      1,
    ])
    const tri = run.setupSubpixel(start, { flags: FLAG_DOUBLE }, 1, ...snapped)
    assert.equal(tri.ok, 1)
    run.rasterRect(tri, 0)
    // The reference: a pixel is covered when its centre is inside the snapped corners, its depth the plane through
    // theirs; its texel the pool page of its page and the pixel’s place in it.
    const expected = new Map<string, number>()
    // The fill rule takes up to a subpixel unit off an edge: a centre that close to one is the rule’s, not the reference’s.
    const near = new Set<string>()
    const length = (u: number[], v: number[]) => Math.hypot(u[0]! - v[0]!, u[1]! - v[1]!)
    const [a, b, c] = snapped as [number[], number[], number[]]
    const area = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!)
    for (let y = 0; y < 8 * side; y++)
      for (let x = 0; x < 8 * side; x++) {
        const p = [(x + 0.5) * S, (y + 0.5) * S]
        const w1 = ((p[0]! - a[0]!) * (c[1]! - a[1]!) - (p[1]! - a[1]!) * (c[0]! - a[0]!)) / area
        const w2 = ((b[0]! - a[0]!) * (p[1]! - a[1]!) - (b[1]! - a[1]!) * (p[0]! - a[0]!)) / area
        const w0 = 1 - w1 - w2
        assert.notEqual(w0 * w1 * w2, 0, 'no pixel centre on an edge')
        const origin = pool[Math.floor(y / side) * 8 + Math.floor(x / side)]!
        const texel = [(origin & 0xffff) * side + (x % side), (origin >>> 16) * side + (y % side)]
        const key = `${texel[0]},${texel[1]}`
        const edges = [
          (w0 * Math.abs(area)) / length(b, c),
          (w1 * Math.abs(area)) / length(a, c),
          (w2 * Math.abs(area)) / length(a, b),
        ]
        if (edges.every((e) => e > -2) && edges.some((e) => Math.abs(e) < 2)) near.add(key)
        if (w0 < 0 || w1 < 0 || w2 < 0 || origin === NONE) continue
        expected.set(key, w0 * a[2]! + w1 * b[2]! + w2 * c[2]!)
      }
    for (const key of near) {
      expected.delete(key)
      written.delete(key)
    }
    assert.ok(expected.size > 100, 'a case with pixels')
    assert.deepEqual([...written.keys()].sort(), [...expected.keys()].sort())
    for (const [key, depth] of expected) {
      const bits = new Float32Array(new Uint32Array([written.get(key)!]).buffer)[0]!
      assert.ok(Math.abs(bits - depth) < 1e-3, `${key}: ${bits} against ${depth}`)
    }
  }
})
