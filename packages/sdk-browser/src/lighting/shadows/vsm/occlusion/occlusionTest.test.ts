// The occlusion's tests in the culls (`occlusionTestWgsl.ts`, `../render/renderCullWgsl.ts`): the
// pyramid read at each page's place, the first cull's holds, a moved caster tested where the
// previous image drew it. Split from `../rasterSkips.test.ts` by subject, as the bound on a test
// file's lines asks.

import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'

import { vsmRenderCandidatesWgsl } from '../render/renderCandidatesWgsl.ts'
import { vsmRenderCullWgsl } from '../render/renderCullWgsl.ts'

import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'

import { Mat, Mat3 } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'
import { SUNS_LAYOUT } from '../layout.fixture.ts'

const LAYOUT = SUNS_LAYOUT
const CULL = vsmRenderCullWgsl(LAYOUT)

/** The clip box of a rect of mip pixels [x0, x1] × [y0, y1] of a 16 384-pixel map, its nearest depth
 *  `depth`, as the box cull gives it: a quarter pixel inside each edge, so no rounding moves it. */
const clipBox = (x0: number, y0: number, x1: number, y1: number, depth: number) => {
  const size = 16384
  const x = (p: number) => (p / size) * 2 - 1
  const y = (p: number) => 1 - (p / size) * 2
  return {
    clipLow: [x(x0 + 0.25), y(y1 + 0.75), depth - 0.1],
    clipHigh: [x(x1 + 0.75), y(y0 + 0.25), depth],
    pastFar: false,
    pastNear: false,
    inMapView: true,
    inDepth: true,
  }
}

/** A map whose table lies at the origin, page (3, 5) of its mip 0 at physical page (2, 1) with its
 *  dynamic layer stale, page (4, 5) mapped at a coarser mip only, page (3, 6) at (5, 1) with no stale
 *  layer; the pyramid 0.5 deep over physical page (2, 1) and 0.2 over (5, 1); every stale rect the
 *  whole mip. The tables and pyramid the cull's occlusion group binds, by load. */
function occlusionScene() {
  const C = wgslConstants(CULL)
  const entry = (x: number, y: number) => (0x80000000 | (y << 10) | x) >>> 0
  const table = new Map([
    ['3,5', entry(2, 1)],
    ['4,5', (0x80000000 | (1 << 20)) >>> 0],
    ['3,6', entry(5, 1)],
  ])
  const marks = new Map([
    ['3,5', C.VSM_PAGE_WANTED | C.VSM_PAGE_DYNAMIC_STALE],
    ['4,5', C.VSM_PAGE_WANTED | C.VSM_PAGE_DYNAMIC_STALE],
    ['3,6', C.VSM_PAGE_WANTED],
  ])
  const word = (m: Map<string, number>) => ({
    load: (at: number[]) => [m.get(`${at[0]},${at[1]}`) ?? 0],
  })
  const pyramidDepth = (x: number, y: number, level: number) => {
    const side = 64 >> level
    const px = Math.floor(x / side),
      py = Math.floor(y / side)
    return px === 2 && py === 1 ? 0.5 : px === 5 && py === 1 ? 0.2 : 0
  }
  return {
    vsm: { hzbStaticLayer: 0 },
    occlusionTable: word(table),
    occlusionMarks: word(marks),
    occlusionRects: { load: () => [0, 0, 127, 127] },
    occlusionPyramid: {},
    textureLoad: (
      texture: { load?: (at: number[]) => number[] },
      at: number[],
      layer: number,
      level?: number,
    ) => (texture.load ? texture.load(at) : [pyramidDepth(at[0], at[1], level!)]),
  }
}

// The occlusion test (`occlusion/occlusionTestWgsl.ts`): the rect at the pyramid level where it spans 4 texels, tested page by
// page at each page's physical place; visible where the caster is not farther than the least of
// those texels, on a page whose marks hold the layer tested and that the table maps at this mip. A
// page mapped only coarser, or not marked for the test, hides it: unmapped counts as occluded.
test('the occlusion test reads the pyramid at each page’s physical place: visible, hidden, unmapped', () => {
  const C = wgslConstants(CULL)
  const run = shaderRun<{
    vsmScreenRect(
      viewRect: number[],
      cull: object,
    ): { pixels: number[]; texels: number[]; level: number; depth: number }
    vsmPagesVisible(
      h: object,
      mip: number,
      rect: object,
      mask: number,
      staticLayer: boolean,
    ): boolean
    vsmHiddenNow(
      h: object,
      mip: number,
      cull: object,
      texels: number,
      clipped: number[],
      mask: number,
      s: boolean,
    ): boolean
  }>(CULL, ['vsmScreenRect', 'vsmPagesVisible', 'vsmHiddenNow'], occlusionScene())
  const map = { id: 0, tableOrigin: 0, finestMip: 0 }
  const view = [0, 0, 16384, 16384]
  const rect = (depth: number, x0 = 400, y0 = 650, x1 = 420, y1 = 660) =>
    run.vsmScreenRect(view, clipBox(x0, y0, x1, y1, depth))
  const r = rect(0.6)
  assert.deepEqual([r.pixels, r.texels, r.level], [[400, 650, 420, 660], [50, 81, 52, 82], 2])
  const stale = C.VSM_PAGE_DYNAMIC_STALE
  assert.equal(
    run.vsmPagesVisible(map, 0, rect(0.6), stale, false),
    true,
    'nearer than the pyramid',
  )
  assert.equal(run.vsmPagesVisible(map, 0, rect(0.5), stale, false), true, 'as deep: visible')
  assert.equal(run.vsmPagesVisible(map, 0, rect(0.4), stale, false), false, 'behind it: hidden')
  assert.equal(
    run.vsmPagesVisible({ ...map, id: 0xffffffff }, 0, rect(0.4), stale, false),
    true,
    'no map, no test',
  )
  // Page (4, 5) is mapped at a coarser mip: no pyramid of its own, it hides what lies on it.
  assert.equal(run.vsmPagesVisible(map, 0, rect(0.9, 520, 650, 530, 660), stale, false), false)
  // Page (3, 6): its pyramid would show the caster, but the layer tested is not stale on it.
  assert.equal(run.vsmPagesVisible(map, 0, rect(0.9, 400, 770, 410, 780), stale, false), false)
  assert.equal(run.vsmPagesVisible(map, 0, rect(0.9, 400, 770, 410, 780), 0xffffffff, false), true)
  // Across pages (3, 5) and (4, 5): visible on the first, so visible.
  assert.equal(run.vsmPagesVisible(map, 0, rect(0.6, 500, 650, 520, 660), stale, false), true)
  assert.equal(run.vsmPagesVisible(map, 0, rect(0.4, 500, 650, 520, 660), stale, false), false)
  // The second cull: hidden behind the pyramid, but never a box past the near plane.
  const box = clipBox(400, 650, 420, 660, 0.4)
  assert.equal(run.vsmHiddenNow(map, 0, box, 16384, [400, 650, 420, 660], stale, false), true)
  assert.equal(
    run.vsmHiddenNow(map, 0, { ...box, pastNear: true }, 16384, [400, 650, 420, 660], stale, false),
    false,
  )
})

// The first cull tests a caster as the map's previous view saw it, against the previous frame's
// pyramid: its box under that view, its sides untested, within its
// depth and short of its near plane; every marked page tested. A map with no previous view hides
// nothing.
test('the first cull holds back what the previous view’s pyramid hides, and nothing without one', () => {
  const run = shaderRun<{
    vsmPrevViewHolds(pd: object, mip: number): boolean
    vsmPrevBoxInView(
      pd: object,
      centre: number[],
      a0: number[],
      a1: number[],
      a2: number[],
      near: boolean,
    ): object
    vsmHiddenBefore(
      pd: object,
      cull: object,
      mip: number,
      texels: number,
      staticLayer: boolean,
    ): boolean
  }>(CULL, ['vsmPrevViewHolds', 'vsmPrevBoxInView', 'vsmHiddenBefore'], occlusionScene())
  // An orthographic previous view taking the box of half extent 1 at the origin to pixels 400..420 ×
  // 650..660 of mip 0, its nearest depth `depth`.
  const pdAt = (depth: number, prevMapId = 0, prevFinestMip = 0) => {
    const b = clipBox(400, 650, 420, 660, depth)
    const s = [0, 1, 2].map((k) => (b.clipHigh[k] - b.clipLow[k]) / 2),
      t = [0, 1, 2].map((k) => (b.clipHigh[k] + b.clipLow[k]) / 2)
    return {
      prevMapId,
      prevTableOrigin: 0,
      prevFinestMip,
      prevShiftedToClip: new Mat([
        s[0],
        0,
        0,
        0,
        0,
        s[1],
        0,
        0,
        0,
        0,
        s[2],
        0,
        t[0],
        t[1],
        t[2],
        1,
      ]),
      prevClipDepth: [0, 0, 1, 0],
    }
  }
  // The box projected once under the previous view, then tested (the cull's, the descent's two layers').
  const hidden = (pd: object) =>
    run.vsmPrevViewHolds(pd, 0) &&
    run.vsmHiddenBefore(
      pd,
      run.vsmPrevBoxInView(pd, [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], false),
      0,
      16384,
      false,
    )
  assert.equal(hidden(pdAt(0.4)), true, 'behind the previous pyramid')
  assert.equal(hidden(pdAt(0.6)), false, 'in front of it')
  assert.equal(hidden(pdAt(0.4, 0xffffffff)), false, 'no previous view')
  assert.equal(hidden(pdAt(1.2)), false, 'past the near plane: drawn')
  // The map got finer since: its mip 0 had no level in the previous table, nothing hides there.
  assert.equal(hidden(pdAt(0.4, 0, 1)), false, 'a mip finer than the previous finest')
})

// The box the first cull tests is the one under the previous pose: its half axes are those of the
// box the placement's previous linear part makes (`vsmRenderPrevAxes`), as the current ones are made
// by the current (`casterSphere`).
test('a candidate carries the half axes of its box under the previous pose', () => {
  const axesOf = (scale: number) => {
    const out = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]
    shaderRun<{
      vsmRenderPrevAxes(
        w: number,
        lo: number[],
        hi: number[],
        reach: number,
        axes: { get(): number[][]; set(value: number[][]): void },
      ): void
    }>(vsmRenderCandidatesWgsl(), ['vsmRenderPrevAxes'], {
      previousLinear: () =>
        new Mat3([
          [scale, 0, 0],
          [0, scale, 0],
          [0, 0, scale],
        ]),
    }).vsmRenderPrevAxes(0, [-1, -1, -1], [1, 1, 1], 0, {
      get: () => out,
      set: (value) => value.forEach((axis, k) => (out[k] = axis)),
    })
    return out
  }
  const near = (a: number[], b: number[]) => a.every((x, k) => Math.abs(x - b[k]!) < 1e-4)
  const [x, y, z] = axesOf(2)
  assert.ok(near(x!, [2, 0, 0]) && near(y!, [0, 2, 0]) && near(z!, [0, 0, 2]), 'twice as large')
  assert.ok(near(axesOf(0.5)[0]!, [0.5, 0, 0]), 'half as large')
})

// The first cull tests a caster where the previous image drew it (its
// previous local-to-world): each candidate carries how far its centre moved since, the previous pose's
// linear part on the box centre beside its exact translation less the sphere's centre, in double —
// nothing for a placement that stood still —, and the cull adds it to the centre it tests.
test('a candidate carries how far it moved since the previous image, which the first cull tests it at', () => {
  /** A double's words as the shaders hold one: high word, low word. */
  const words = (x: number) => {
    const u = new Uint32Array(new Float64Array([x]).buffer)
    return [u[1], u[0]]
  }
  const origin = (t: number[]) => (k: number) =>
    k === 0 ? [...words(t[0]), ...words(t[1])] : [...words(t[2]), 0, 0]
  const shiftOf = (linear: number[][], translation: number[], high: number[], low: number[]) =>
    shaderRun<{ vsmRenderPrevShift(w: number, c: number[], h: number[], l: number[]): number[] }>(
      vsmRenderCandidatesWgsl(),
      ['vsmRenderPrevShift'],
      {
        previousLinear: () => new Mat3(linear),
        previousOrigin: (_w: number, k: number) => origin(translation)(k),
      },
    ).vsmRenderPrevShift(0, [0.25, 0.5, -1], high, low)
  const identity = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  assert.deepEqual(shiftOf(identity, [11, 18, 30.5], [10, 20, 30], [0, 0, 0]), [1.25, -1.5, -0.5])
  assert.deepEqual(shiftOf(identity, [9.75, 19.5, 31], [10, 20, 30], [0, 0, 0]), [0, 0, 0], 'still')
  // Far from the origin the translation is a double: the shift keeps the bits a single loses.
  const far = 2 ** 25 + 0.5
  assert.deepEqual(
    shiftOf(
      identity,
      [far, 0, 0],
      [Math.fround(far + 0.25), 0.5, -1],
      [far + 0.25 - Math.fround(far + 0.25), 0, 0],
    ),
    [0, 0, 0],
  )
})

// The invalidation's test of one page (`vsmPageVisibleHzb`): the rect held at its page level, read at the page's
// physical place; a page the table does not map at this mip is seen when unmapped counts as visible.
test('the page test of the invalidation: seen where the pyramid shows the rect, or where nothing maps the page', () => {
  const run = shaderRun<{
    vsmScreenRect(viewRect: number[], cull: object): object
    vsmPageLevelRect(rect: object): object
    vsmPageVisibleHzb(
      h: object,
      mip: number,
      rect: object,
      x: number,
      y: number,
      unmappedOccluded: boolean,
      staticLayer: boolean,
    ): boolean
  }>(CULL, ['vsmScreenRect', 'vsmPageLevelRect', 'vsmPageVisibleHzb'], occlusionScene())
  const map = { id: 0, tableOrigin: 0, finestMip: 0 }
  const rect = (depth: number) =>
    run.vsmPageLevelRect(
      run.vsmScreenRect([0, 0, 16384, 16384], clipBox(400, 650, 420, 660, depth)),
    )
  assert.equal(
    run.vsmPageVisibleHzb(map, 0, rect(0.6), 3, 5, false, true),
    true,
    'nearer than the pyramid',
  )
  assert.equal(run.vsmPageVisibleHzb(map, 0, rect(0.4), 3, 5, false, true), false, 'behind it')
  // Page (4, 5) is mapped at a coarser mip only: seen when unmapped is visible (the invalidation), hidden when not (the cull).
  assert.equal(run.vsmPageVisibleHzb(map, 0, rect(0.4), 4, 5, false, true), true)
  assert.equal(run.vsmPageVisibleHzb(map, 0, rect(0.4), 4, 5, true, true), false)
})
