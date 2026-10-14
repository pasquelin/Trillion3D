// The invalidation of an instance's pages, on the shared box cull (`boxCullWgsl.ts`), held to a
// golden taken when it was proved to do what it did on its own: the pixel rect and pixel radius at
// each mip, the page words written with their bits, in their order, over seeded lights — suns
// and local lights, turned at random, or every value drawn with its edges — and instances about
// them, on stand-in page tables, in the one stale's module (`castInvalidationWgsl.ts`). The instances
// are the boxes a change stales, their axes the world's, and carry its flags: casts shadows, and
// cached as dynamic or not, each in its own bits. Retaken on the kernel of before over the same
// boxes as identity-rotation instances (the one kind it was handed): the box alone, its instance
// now, makes the same writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../texture/shaderRule.fixture.ts'
import { handle, lightView, record, run, tables, use } from './boxCullTables.fixture.ts'
import { UNBOUNDED_EXTENT, VSM_BOX_MOVING, VSM_BOX_CASTS } from './invalidationWgsl.ts'
import { castInvalidationWgsl } from './castInvalidationWgsl.ts'
import { bitsDigest, inputs } from './sameBits.fixture.ts'
import { vsmLayout } from './layout.ts'

const INVALIDATION = castInvalidationWgsl(vsmLayout({ fullMapCapacity: 63 }))
const CASES = 12000
/** The digest of every case's writes (`bitsDigest`). */
const GOLDEN = ''
const HELPERS = [
  ...['vsmStaleBoxPages', 'vsmTouchesMappedPage', 'vsmMarksMatch'],
  ...['vsmLevelHoldingRect', 'vsmClipRadius', 'vsmCachesAsStatic'],
  'perspectiveDivide',
  'floorLog2',
]
type Fn = (...args: unknown[]) => unknown
/** The page rect and the detail geometry of a text, each call logged with what it is handed: the
 *  pixel rect and the pixel radius. */
const logged = (source: string) => {
  const own = run(source, ['vsmMappedRectPages', 'vsmIsFineCaster'])
  return {
    vsmMappedRectPages: (rect: number[], ...at: unknown[]) => {
      record('rect', rect, ...at)
      return own.vsmMappedRectPages(rect, ...at)
    },
    vsmIsFineCaster: (...args: unknown[]) => {
      record('detail', args[0], args[args.length - 1])
      return own.vsmIsFineCaster(...args)
    },
  } as Record<string, Fn>
}

test("an instance's pages are invalidated as the golden holds: the same writes in the same order", () => {
  const is = run(
    INVALIDATION,
    [
      ...HELPERS,
      ...['vsmBoxCullPoint', 'vsmBoxInView', 'vsmBoxInOrthoView', 'vsmBoxInPerspectiveView'],
      ...['vsmRectPixels', 'vsmRectMarks'],
    ],
    logged(INVALIDATION),
  )
  const { LIGHT_KIND_DIRECTIONAL } = wgslConstants(INVALIDATION)
  let writing = 0
  const digest = bitsDigest()
  for (let k = 0; k < CASES; k++) {
    // Two cases in three about the light, their values in a few metres; the third drawn whole.
    const d = inputs(3 * 10 ** 5 + k, { edge: k % 3 ? 64 : 8 }),
      light = lightView(d, k),
      about = k % 3 !== 0
    const near = (n: number) =>
      d.vec(n, () => (about ? Math.fround((d.random() - 0.5) * 16) : d.f()))
    const low = () => d.vec(3, () => Math.fround(d.random() * 1e-3))
    const pd = {
      lightKind: light.directional ? LIGHT_KIND_DIRECTIONAL : d.int(1, 3),
      originShiftHigh: near(3),
      originShiftLow: low(),
      handle: handle(d),
      lightRange: about ? d.int(1, 40) : d.f(),
      shiftedToMapUv: light.uv,
      lightViewToClip: light.viewToClip,
      uncached: d.bool(),
      levelsLeft: d.int(-1, 3),
      finestMip: d.int(0, 7),
      coarseDynamicCached: d.bool(),
      levelShapeCutoffSq: d.f(),
    }
    // A change's box: its centre, its half extent along the world's axes — finite, as a record's
    // is: past f32 math the list holds the unbounded box (`UNBOUNDED_EXTENT`).
    const centre = near(3),
      dynamic = d.bool(),
      extent = near(3).map((x) => (Number.isFinite(x) ? Math.abs(x) : UNBOUNDED_EXTENT))
    const inst = { centre, flags: VSM_BOX_CASTS | (dynamic ? VSM_BOX_MOVING : 0), extent }
    const now = use(tables(k, inputs(k)))
    is.vsmStaleBoxPages(pd, inst)
    digest.add(now.writes)
    writing += Number(now.writes.some((entry) => typeof entry[0] === 'number'))
  }
  assert.equal(digest.hex(), GOLDEN)
  assert.ok(writing > CASES / 20, `${writing} cases write`)
})
