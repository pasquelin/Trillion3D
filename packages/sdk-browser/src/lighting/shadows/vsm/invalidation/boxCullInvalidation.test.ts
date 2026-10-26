// The invalidation of an instance's pages, on the shared box cull (`boxCullWgsl.ts`), held to a
// golden taken when it was proved to do what it did on its own: the pixel rect and pixel radius at
// each mip, the page words written with their bits, in their order, over seeded lights — suns and
// local lights, turned at random, or every value drawn with its edges — and instances about them,
// on stand-in page tables, in the one stale's module (`castInvalidationWgsl.ts`). The instances are
// the boxes a change stales, their axes the world's, and carry its flags: casts shadows, and cached
// as dynamic or not, each in its own bits. Retaken on the kernel of before over the same boxes as
// identity-rotation instances (the one kind it was handed): the box alone, its instance now, makes
// the same writes. Retaken when the maps became one kind: no single-page map, whose one page the
// kernel staled whatever the box, a local light's kind drawn in the lights' one numbering
// (`LIGHT_KIND`, where a drawn 2 now names a sun), and the clip matrix recovered from the UV one
// column by column (`vsmShiftedToClip`): over the same draws every case wrote as before, but the
// 127 of the values drawn whole whose matrices are not finite, where the product's 0·∞ terms no
// longer make a NaN. The handle then names one of the maps the stand-in tables hold rects for
// (`boxCullTables.fixture.ts`): the single-page maps were what made a case write. Retaken once
// more on the shipped text, the digest above never having reproduced from the commit that took it:
// the same one on every commit since, the working tree's changes leaving it as it was.
// Retaken when the stale became the reference's oriented-box invalidation: the box carries its half
// axes (a diagonal matrix here, the world's axes) and the views it stales, and is carried to clip
// space as a unit box through them; a map of one page (the finest mip the last) has that page's static
// layer staled and is done; the hierarchical test looks for fine pages by the detail test alone, the
// page test adding the fine bit only for a mover's box in a map whose coarse pages keep their dynamic
// layer. Reverting any one of those three alone gives a third digest, all three together the digest
// of before; the pages of the pyramid test are left out (occlusion off).
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { handle, lightView, record, run, tables, use } from './boxCullTables.fixture.ts'
import { UNBOUNDED_EXTENT } from '../invalidationWgsl.ts'
import { castInvalidationWgsl } from './castInvalidationWgsl.ts'
import { bitsDigest, inputs } from '../bitsDigest.fixture.ts'
import { vsmLayout } from '../layout.ts'
import { LIGHT_KIND } from '../../../../../../sdk-core/src/scene/light/contracts.ts'

const INVALIDATION = castInvalidationWgsl(vsmLayout({ fullMapCapacity: 63, occlusion: false }))
const LOCAL_KINDS = [LIGHT_KIND.point, LIGHT_KIND.spot, LIGHT_KIND.rect]
const CASES = 12000
/** The digest of every case's writes (`bitsDigest`). */
const GOLDEN = 'f2099b9fc8b11818a59a31544424c196e362b4793e2bf137462ec4cd38602e92'
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
  const { LIGHT_KIND_DIRECTIONAL, VSM_BOX_MOVING } = wgslConstants(INVALIDATION)
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
      // A local light's kind: a point, a spot or a rectangle (`LIGHT_KIND`), never a sun's.
      lightKind: light.directional ? LIGHT_KIND_DIRECTIONAL : LOCAL_KINDS[d.int(1, 3) - 1],
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
      viewSlot: 0,
    }
    // A change's box: its centre, its half extent along the world's axes — finite, as a record's
    // is: past f32 math the list holds the unbounded box (`UNBOUNDED_EXTENT`).
    const centre = near(3),
      dynamic = d.bool(),
      extent = near(3).map((x) => (Number.isFinite(x) ? Math.abs(x) : UNBOUNDED_EXTENT))
    // Along the world's axes: the half axes are the extent on the diagonal.
    const inst = {
      centre,
      flags: dynamic ? VSM_BOX_MOVING : 0,
      axisX: [extent[0], 0, 0],
      axisY: [0, extent[1], 0],
      axisZ: [0, 0, extent[2]],
      views: 0xffffffff,
    }
    const now = use(tables(k, inputs(k)))
    is.vsmStaleBoxPages(pd, inst)
    digest.add(now.writes)
    writing += Number(now.writes.some((entry) => typeof entry[0] === 'number'))
    // A map that uses the receiver cover draws its dynamic layer again each frame: a box of casters
    // already moving writes nothing in it, whatever the light and the box.
    const covered = use(tables(k, inputs(k)))
    is.vsmStaleBoxPages({ ...pd, useCover: true }, { ...inst, flags: VSM_BOX_MOVING })
    assert.deepEqual(covered.writes, [], `case ${k}`)
  }
  assert.equal(digest.hex(), GOLDEN)
  assert.ok(writing > CASES / 25, `${writing} cases write`)
})
