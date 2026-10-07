// The invalidation of an instance's pages, on the shared box cull (`boxCullWgsl.ts`), does what it
// did on its own (`boxCull*Before.fixture.ts`): the same pixel rect and pixel radius at each mip,
// the same page words written with the same bits, in the same order, over seeded lights — suns
// and local lights, turned at random, or every value drawn with its edges — and instances about
// them, on stand-in page tables. The instances carry the flags the host sets (`packBox`,
// `invalidationPass.ts`): casts shadows, and cached as dynamic or not, each in its own bits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../texture/shaderRule.fixture.ts'
import { INVALIDATION_BOX_CULL } from './boxCullBefore.fixture.ts'
import { INVALIDATION_FLAGS_BEFORE, INVALIDATION_PAGES } from './boxCullPagesBefore.fixture.ts'
import { handle, lightView, record, run, tables, use } from './boxCullTables.fixture.ts'
import { VSM_BOX_MOVING, VSM_BOX_CASTS, vsmInvalidationWgsl } from './invalidationWgsl.ts'
import { inputs, sameBits } from './sameBits.fixture.ts'
import { vsmLayout } from './layout.ts'

const INVALIDATION = vsmInvalidationWgsl(vsmLayout({ fullMapCapacity: 63 }, 1 << 27))
const CASES = 12000
const HELPERS = [
  ...['vsmStaleBoxPages', 'vsmTouchesMappedPage', 'vsmMarksMatch'],
  ...['vsmLevelHoldingRect', 'vsmClipRadius', 'vsmCachesAsStatic'],
  'perspectiveDivide',
]
type Fn = (...args: unknown[]) => unknown
/** The page rect and the detail geometry of a text, each call logged with what it is handed: the
 *  pixel rect (the screen rect's before) and the pixel radius. Before, the detail geometry was
 *  also handed a cluster bit, which no flag the host sets raises: it must be false. */
const logged = (source: string, names: string[], scope: object = {}) => {
  const own = run(source, ['vsmMappedRectPages', 'vsmIsFineCaster', ...names], scope)
  return {
    vsmMappedRectPages: (rect: { pixels?: number[] }, ...at: unknown[]) => {
      record('rect', rect.pixels ?? rect, ...at)
      return own.vsmMappedRectPages(rect, ...at)
    },
    vsmIsFineCaster: (...args: unknown[]) => {
      if (args.length === 3) assert.equal(args[1], false, 'no cluster caster')
      record('detail', args[0], args[args.length - 1])
      return own.vsmIsFineCaster(...args)
    },
  } as Record<string, Fn>
}

test("an instance's pages are invalidated as before: the same writes in the same order", () => {
  const before = INVALIDATION_PAGES + INVALIDATION_BOX_CULL + INVALIDATION
  const was = run(
    before,
    [
      ...HELPERS,
      ...['vsmShapeAllowed', 'vsmShapeStalesCache'],
      ...[
        'vsmShiftedBoxInView',
        'vsmShiftedBoxOrtho',
        'vsmShiftedBoxPerspective',
        'vsmMin3v2',
        'vsmMax3v2',
      ],
      'vsmPixelRectOf',
    ],
    {
      ...INVALIDATION_FLAGS_BEFORE,
      ...logged(before, ['vsmPagesOfRect'], INVALIDATION_FLAGS_BEFORE),
    },
  )
  const is = run(
    INVALIDATION,
    [
      ...HELPERS,
      ...['vsmBoxInMapView', 'vsmBoxInOrthoView', 'vsmBoxInPerspectiveView'],
      ...['vsmRectPixels', 'vsmRectMarks'],
    ],
    logged(INVALIDATION, []),
  )
  const { LIGHT_KIND_DIRECTIONAL } = wgslConstants(INVALIDATION)
  let writing = 0
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
      ...{ originShiftHigh: near(3), originShiftLow: low(), handle: handle(d) },
      ...{ lightRange: about ? d.int(1, 40) : d.f(), shiftedToMapUv: light.uv },
      ...{ lightViewToClip: light.viewToClip, uncached: d.bool() },
      ...{ levelsLeft: d.int(-1, 3), finestMip: d.int(0, 7) },
      ...{ coarseDynamicCached: d.bool(), levelShapeCutoffSq: d.f() },
    }
    const column = () => [...near(3), near(1)[0] * 4]
    const dynamic = d.bool()
    const inst = {
      ...{ localToWorld0: column(), localToWorld1: column(), localToWorld2: column() },
      ...{
        translationLow: low(),
        boxCentre: near(3),
        boxExtent: near(3).map(Math.abs),
      },
      boxShapeCutoffSq: d.f(),
    }
    const old = INVALIDATION_FLAGS_BEFORE
    const then = use(tables(k, inputs(k)))
    was.vsmStaleBoxPages(pd, {
      ...inst,
      flags: old.VSM_BOX_CASTS | (dynamic ? old.VSM_BOX_MOVING : 0),
    })
    const now = use(tables(k, inputs(k)))
    is.vsmStaleBoxPages(pd, {
      ...inst,
      flags: VSM_BOX_CASTS | (dynamic ? VSM_BOX_MOVING : 0),
    })
    assert.ok(sameBits(now.writes, then.writes), `case ${k}`)
    writing += Number(then.writes.some((entry) => typeof entry[0] === 'number'))
  }
  assert.ok(writing > CASES / 20, `${writing} cases write`)
})
