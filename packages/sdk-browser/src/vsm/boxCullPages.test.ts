// The page tests of the shared cull (`boxCullWgsl.ts`) in the cache invalidation and the render
// cull, held to goldens of their every bit: the flag mask test, the overlap of a rect with valid
// pages, the allocated page rect, the clip-space radius of a sphere and the detail geometry, over
// seeded inputs with their edges and stand-in page tables. The goldens were taken when the shared
// tests were proved, case for case, the ones each module had of its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { builtins } from '../texture/shaderRunBuiltins.fixture.ts'
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
import { bitsDigest, inputs } from './sameBits.fixture.ts'

const CASES = 12000
/** The digests of the runs below (`bitsDigest`). */
const GOLDEN = {
  marks: 'f904325da7ce4a671c6dde23e0fd7b982f7a8ee8190182137177d38da304c276',
  pixels: '316247eedf7bcd5a73613fd345dccdd0e5fbd6f3aa295eac3c6423f4c057029e',
  pages: '4efaf63b91619b884a0643970a0902a16e05a35e1e6bdd1e34b729e8226b8d53',
}
/** Case `k`'s draw, its tables in use. */
const at = (k: number) => {
  const d = inputs(k)
  return { d, t: use(tables(k, d)) }
}

type Run = Record<string, (...args: unknown[]) => unknown>
/** Every case from `first` on, what `is` answers to the arguments `argsOf` draws, as a digest
 *  (with what `argsOf` adds to it); about one case in two touches a page (a test that never hits
 *  proves nothing). */
function touches(
  is: Run,
  first: number,
  argsOf: (d: Draw, digest: ReturnType<typeof bitsDigest>) => unknown[],
  name = 'vsmTouchesMappedPage',
) {
  let overlaps = 0
  const digest = bitsDigest()
  for (let k = 0; k < CASES; k++) {
    const result = is[name](...argsOf(at(first + k).d, digest))
    digest.add(result)
    overlaps += Number(result)
  }
  assert.ok(overlaps > CASES / 10 && overlaps < CASES * 0.9, `${overlaps}`)
  return digest.hex()
}

test("the flag mask test and the overlap of a page rect keep the invalidation's golden bits", () => {
  const names = ['vsmTouchesMappedPage', 'vsmMarksMatch', 'vsmLevelHoldingRect', 'floorLog2']
  const is = run(INVALIDATION, [...names, 'vsmRectMarks'])
  const hex = touches(is, 0, (d, digest) => {
    const flags = d.int(0, 1) ? d.int(0, 2 ** 32 - 1) : d.pick([0, 1, 7, 8, 9, 15])
    const mask = d.pick([1, 2, 4, 6, 7, 9, 15, d.int(0, 255)])
    digest.add(is.vsmMarksMatch(flags, mask))
    return [handle(d), d.int(0, 7), pageRect(d, 128), mask, d.bool()]
  })
  assert.equal(hex, GOLDEN.marks)
})

test("the overlap of a pixel rect with valid pages keeps the render cull's golden, receiver cover and all", () => {
  const names = ['vsmTouchesMappedPage', 'vsmMaskRectHits', 'vsmBitRun']
  const shared = ['vsmMarksMatch', 'vsmLevelHoldingRect', 'floorLog2']
  const is = run(RENDER, [...names, 'vsmTouchesMappedPixels', ...shared, 'vsmRectMarks'])
  const hex = touches(
    is,
    10 ** 5,
    (d) => [handle(d), d.int(0, 7), pageRect(d, 16383), d.int(0, 15), d.bool(), d.bool()],
    'vsmTouchesMappedPixels',
  )
  assert.equal(hex, GOLDEN.pixels)
})

test('the allocated rect, the radius and the detail geometry keep their golden bits, the detail the same in both modules', () => {
  const names = ['vsmMappedRectPages', 'vsmClipRadius', 'vsmIsFineCaster']
  const is = run(INVALIDATION, names),
    render = run(RENDER, ['vsmIsFineCaster'])
  // Both read the shared fine-caster test with no cluster caster, as the render cull did.
  assert.ok(RENDER.includes('vsmIsFineCaster(staticLayer,pixelRadius)'))
  const digest = bitsDigest()
  for (let k = 0; k < CASES; k++) {
    const { d, t } = at(2 * 10 ** 5 + k)
    const pixels = pageRect(d, 16383).map((x) => (x === 0xffffffff ? d.int(0, 99) : x)),
      map = [handle(d), d.int(0, 7)]
    digest.add(is.vsmMappedRectPages(pixels, ...map))
    // The invalidation hands the shared estimate its instance's radius and shifted centre (none
    // for a sun's orthographic view, which reads none).
    const inst = { boxExtent: d.vec(3), boxCentre: d.vec(3) }
    const [scale, toShifted, viewToClip, ortho] = [d.vec(3), d.mat(), d.mat(), d.bool()]
    const radius = builtins.length(builtins.$b('*', inst.boxExtent, scale))
    const centre = builtins.$b('*', toShifted, [...inst.boxCentre, 1]) as number[]
    const shifted = ortho ? [0, 0, 0] : centre.slice(0, 3)
    digest.add(is.vsmClipRadius(ortho, radius, shifted, viewToClip))
    // A radius now and then on a threshold.
    const r = d.int(0, 3) ? d.f() : d.pick(Object.values(t.vsm)),
      cached = d.bool()
    const detail = is.vsmIsFineCaster(cached, r)
    digest.add(detail)
    assert.equal(render.vsmIsFineCaster(cached, r), detail, `case ${k}`)
  }
  assert.equal(digest.hex(), GOLDEN.pages)
})

test('the level offset of a span is its exact base-2 logarithm, as the device log2 rounded it', () => {
  // `vsmLevelHoldingRect` once truncated `log2(f32(spanTexels))`, now takes `floorLog2`: the same
  // integer for every span an f32 holds exactly, the shipped 2 among them, in the log2 the runs
  // above emulate.
  for (let span = 1; span <= 2 ** 24; span++)
    if (Math.trunc(Math.log2(Math.fround(span))) !== 31 - Math.clz32(span)) assert.fail(`${span}`)
  assert.ok(INVALIDATION.includes('let mipOffset=i32(floorLog2(u32(spanTexels)))-1;'))
})
