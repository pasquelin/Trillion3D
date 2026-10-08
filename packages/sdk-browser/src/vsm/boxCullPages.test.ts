// The page tests of the shared cull (`boxCullWgsl.ts`) give the cache invalidation and the render
// cull, bit for bit, what their own gave (`boxCullPagesBefore.fixture.ts`): the flag mask test,
// the overlap of a rect with valid pages, the allocated page rect, the clip-space radius of a
// sphere and the detail geometry, over seeded inputs with their edges and stand-in page tables.
import test from 'node:test'
import assert from 'node:assert/strict'
import { builtins } from '../texture/shaderRunBuiltins.fixture.ts'
import { INVALIDATION_BOX_CULL, RENDER_BOX_CULL } from './boxCullBefore.fixture.ts'
import { INVALIDATION_PAGES, RENDER_PAGES } from './boxCullPagesBefore.fixture.ts'
import {
  type Draw,
  INVALIDATION,
  RENDER,
  handle,
  pageRect,
  run,
  tables,
  use,
} from './boxCullTables.fixture.ts'
import { inputs, sameBits } from './sameBits.fixture.ts'

/** The texts before: the old functions first, the shipped module after them for the rest. */
const INVALIDATION_BEFORE = INVALIDATION_PAGES + INVALIDATION_BOX_CULL + INVALIDATION,
  RENDER_BEFORE = RENDER_PAGES + RENDER_BOX_CULL + INVALIDATION_PAGES + RENDER
const CASES = 12000
/** Case `k`'s draw, its tables in use. */
const at = (k: number) => {
  const d = inputs(k)
  return { d, t: use(tables(k, d)) }
}

type Run = Record<string, (...args: unknown[]) => unknown>
/** Every case from `first` on: `is` answers what `was` answered to the arguments `argsOf` draws,
 *  and about one case in two touches a page (a test that never hits proves nothing). */
function sameTouches(was: Run, is: Run, first: number, argsOf: (d: Draw) => unknown[]) {
  let overlaps = 0
  for (let k = 0; k < CASES; k++) {
    const args = argsOf(at(first + k).d)
    const result = is.vsmTouchesMappedPage(...args)
    assert.equal(result, was.vsmTouchesMappedPage(...args), `case ${k}`)
    overlaps += Number(result)
  }
  assert.ok(overlaps > CASES / 10 && overlaps < CASES * 0.9, `${overlaps}`)
}

test("the flag mask test and the overlap of a page rect are the invalidation's, bit for bit", () => {
  const names = ['vsmTouchesMappedPage', 'vsmMarksMatch', 'vsmLevelHoldingRect', 'floorLog2']
  const was = run(INVALIDATION_BEFORE, names),
    is = run(INVALIDATION, [...names, 'vsmRectMarks'])
  sameTouches(was, is, 0, (d) => {
    const flags = d.int(0, 1) ? d.int(0, 2 ** 32 - 1) : d.pick([0, 1, 7, 8, 9, 15])
    const mask = d.pick([1, 2, 4, 6, 7, 9, 15, d.int(0, 255)])
    assert.equal(is.vsmMarksMatch(flags, mask), was.vsmMarksMatch(flags, mask))
    return [handle(d), d.int(0, 7), pageRect(d, 128), mask, d.bool()]
  })
})

test("the overlap of a pixel rect with valid pages is the render cull's, receiver cover and all", () => {
  const names = ['vsmTouchesMappedPage', 'vsmMaskRectHits', 'vsmBitRun']
  const shared = ['vsmMarksMatch', 'vsmLevelHoldingRect', 'floorLog2']
  const was = run(RENDER_BEFORE, [...names, ...shared]),
    is = run(RENDER, [...names, ...shared, 'vsmRectMarks'])
  sameTouches(was, is, 10 ** 5, (d) => [
    handle(d),
    d.int(0, 7),
    pageRect(d, 16383),
    d.int(0, 15),
    d.bool(),
    d.bool(),
  ])
})

test("the allocated rect, the radius and the detail geometry are each module's own, bit for bit", () => {
  const names = ['vsmMappedRectPages', 'vsmClipRadius', 'vsmIsFineCaster']
  const was = run(INVALIDATION_BEFORE, [...names, 'vsmPagesOfRect']),
    is = run(INVALIDATION, names),
    render = run(RENDER_PAGES, ['vsmIsFineCaster'])
  // Both read the shared fine-caster test with no cluster caster, as the render cull did.
  assert.ok(RENDER.includes('vsmIsFineCaster(staticLayer,pixelRadius)'))
  for (let k = 0; k < CASES; k++) {
    const { d, t } = at(2 * 10 ** 5 + k)
    const pixels = pageRect(d, 16383).map((x) => (x === 0xffffffff ? d.int(0, 99) : x)),
      map = [handle(d), d.int(0, 7)]
    const rect = is.vsmMappedRectPages(pixels, ...map)
    assert.ok(sameBits(rect, was.vsmMappedRectPages({ pixels }, ...map)), `case ${k}`)
    // The invalidation hands the shared estimate its instance's radius and shifted centre (none
    // for a sun's orthographic view, which reads none).
    const inst = { boxExtent: d.vec(3), boxCentre: d.vec(3) }
    const [scale, toShifted, viewToClip, ortho] = [d.vec(3), d.mat(), d.mat(), d.bool()]
    const radius = builtins.length(builtins.$b('*', inst.boxExtent, scale))
    const centre = builtins.$b('*', toShifted, [...inst.boxCentre, 1]) as number[]
    const shifted = ortho ? [0, 0, 0] : centre.slice(0, 3)
    const estimate = is.vsmClipRadius(ortho, radius, shifted, viewToClip)
    const before = was.vsmClipRadius(ortho, inst, scale, toShifted, viewToClip)
    assert.ok(sameBits(estimate, before), `case ${k}`)
    // A radius now and then on a threshold.
    const r = d.int(0, 3) ? d.f() : d.pick(Object.values(t.vsm)),
      cached = d.bool()
    const detail = is.vsmIsFineCaster(cached, r)
    assert.equal(detail, was.vsmIsFineCaster(cached, false, r), `case ${k}`)
    assert.equal(detail, render.vsmIsFineCaster(cached, r))
  }
})

test('the level offset of a span is its exact base-2 logarithm, as the device log2 rounded it', () => {
  // `vsmLevelHoldingRect` once truncated `log2(f32(spanTexels))`, now takes `floorLog2`: the same
  // integer for every span an f32 holds exactly, the shipped 2 among them, in the log2 the runs
  // above emulate.
  for (let span = 1; span <= 2 ** 24; span++)
    if (Math.trunc(Math.log2(Math.fround(span))) !== 31 - Math.clz32(span)) assert.fail(`${span}`)
  assert.ok(INVALIDATION.includes('let mipOffset=i32(floorLog2(u32(spanTexels)))-1;'))
})
