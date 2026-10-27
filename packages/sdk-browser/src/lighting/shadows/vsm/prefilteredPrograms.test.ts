// What a set without the prefiltered distant shadow runs is the text it always ran, and a set with it
// differs by the lines the feature changes: the three page markings, the pyramid of the page marks,
// the keep and the grant of the pages. The raster's cull and the shadow views' descent are run as
// text by `prefilteredCull.test.ts`. The storage bindings of each stay within a stage's.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { VsmLayout } from './layout.ts'
import { VSM_PREFILTERED_WGSL } from './prefilteredWgsl.ts'
import { vsmFilterableKernels } from './filterableWgsl.ts'
import { vsmFroxelPageMarkingWgsl } from './froxel/froxelMarkWgsl.ts'
import { vsmCoarseMarkingWgsl, vsmPixelPageMarkingWgsl } from './markingWgsl.ts'
import { vsmPageManagementKernels } from './pageManagementWgsl.ts'
import { vsmPhysicalPageKernels } from './physicalPagesWgsl.ts'
import { vsmRenderCullWgsl } from './render/renderCullWgsl.ts'
import { vsmDescentWgsl } from './traversal/traversalWgsl.ts'
import { OFF, ON } from './prefiltered.fixture.ts'

const codes = (kernels: object) =>
  Object.fromEntries(
    Object.entries(kernels as Record<string, { code: string }>).map(([name, { code }]) => [
      name,
      code,
    ]),
  )

/** Every program a layout runs that the feature touches, by name. */
const programs = (layout: VsmLayout, stats = false): Record<string, string> => ({
  ...{ cull: vsmRenderCullWgsl(layout), cullThrottled: vsmRenderCullWgsl(layout, true) },
  ...{ descent: vsmDescentWgsl(layout), coarse: vsmCoarseMarkingWgsl(layout) },
  ...{ pixels: vsmPixelPageMarkingWgsl(layout), froxel: vsmFroxelPageMarkingWgsl(layout) },
  ...{ pixelsThrottled: vsmPixelPageMarkingWgsl(layout, false, false, true) },
  ...{ froxelThrottled: vsmFroxelPageMarkingWgsl(layout, true) },
  ...codes(vsmPageManagementKernels(layout)),
  ...codes(vsmPhysicalPageKernels(layout, { stats })),
})

const MARKERS = new RegExp(
  [
    ...['VSM_PAGE_PRIMARY', 'VSM_PAGE_SECONDARY', 'VSM_PAGE_AUX_MASK', 'VSM_MAP_PREFILTERED'],
    ...['vsmMapPrefiltered', 'vsmCasterMarkMask', 'vsmEntrySecondary', 'vsmClipmapLevelIndex'],
    ...['vsmPackSecondaryTableEntry', 'vsmFilterable', 'vsmPrevFilterable', 'VSM_FILTER'],
    ...['filterableArgs', 'filterablePages', 'vsmPropagateFilterable'],
  ].join('|'),
)

test('a set without the feature runs no program that names it', () => {
  for (const [name, code] of Object.entries(programs(OFF, true)))
    assert.doesNotMatch(code, MARKERS, name)
  assert.deepEqual(Object.keys(vsmPageManagementKernels(OFF)), [
    'pageFlagPyramid',
    'fillCoarserFallbacks',
  ])
  assert.deepEqual(
    Object.keys(vsmPageManagementKernels(ON)),
    Object.keys(vsmPageManagementKernels(OFF)),
  )
})

/** The lines of a text a reader skips: comments, braces and blank lines. */
const significant = (line: string) => !/^(\/\/|\/\*\*|\*|\}$|$)/.test(line.trim())

/** The lines `off` and `on` do not share, as multisets, trimmed and sorted, but for the comments and
 *  the lines of the feature's own constants block. */
function changed(off: string, on: string) {
  const own = new Set(VSM_PREFILTERED_WGSL.text.split('\n'))
  const count = (text: string) => {
    const held = new Map<string, number>()
    for (const line of text.split('\n')) held.set(line, (held.get(line) ?? 0) + 1)
    return held
  }
  const [a, b] = [count(off), count(on)]
  const only = (from: Map<string, number>, other: Map<string, number>, skip: Set<string>) =>
    [...from]
      .flatMap(([line, n]) => Array<string>(Math.max(0, n - (other.get(line) ?? 0))).fill(line))
      .filter((line) => significant(line) && !skip.has(line))
      .map((line) => line.trim())
      .sort()
  return { removed: only(a, b, new Set()), added: only(b, a, own) }
}

const SORTED = (lines: string[]) => [...lines].sort()
const FLAGS_OFF = 'let flags=VSM_PAGE_WANTED|VSM_PAGE_FINE;'

test('with the feature every page marked from the view asks the primary request', () => {
  const [off, on] = [programs(OFF), programs(ON)]
  const marked = (name: string, plain: string, flags: string, times = 1) => {
    const { removed, added } = changed(off[name], on[name])
    assert.deepEqual([removed, added], [Array(times).fill(plain), Array(times).fill(flags)], name)
  }
  const fine = 'let flags=VSM_PAGE_WANTED|VSM_PAGE_FINE|VSM_PAGE_PRIMARY;'
  for (const name of ['pixels', 'pixelsThrottled']) marked(name, FLAGS_OFF, fine)
  // The froxel pass marks a froxel's pages and, with the pixel marking's helpers, a point's.
  for (const name of ['froxel', 'froxelThrottled']) marked(name, FLAGS_OFF, fine, 2)
  marked('coarse', 'let flags=VSM_PAGE_WANTED;', 'let flags=VSM_PAGE_WANTED|VSM_PAGE_PRIMARY;')
})

test('the page marks’ pyramid, the keep and the grant carry the request bits', () => {
  const [off, on] = [programs(OFF), programs(ON)]
  const pyramid = changed(off.pageFlagPyramid, on.pageFlagPyramid)
  const flag = (mask: string) =>
    `let flag=vsmPageMarksLoad(vsmPageMarkIndex(tableAt.tableXY,0u))&${mask};`
  assert.deepEqual(pyramid.removed, [flag('VSM_PAGE_MARK_MASK')])
  assert.deepEqual(pyramid.added, [
    flag('(VSM_PAGE_MARK_MASK|VSM_PAGE_PRIMARY|VSM_PAGE_SECONDARY)'),
  ])
  // A page whose request bits differ from those it holds is drawn again whole.
  const keep = changed(off.keepPages, on.keepPages)
  assert.deepEqual(
    keep.removed,
    SORTED([
      'let requestFine=requestWord&VSM_PAGE_FINE;',
      'if(requestFine!=(prevMeta&VSM_PAGE_FINE)){',
    ]),
  )
  assert.deepEqual(
    keep.added,
    SORTED([
      'let requestFine=requestWord&VSM_PAGE_AUX_MASK;',
      'if(requestFine!=(prevMeta&VSM_PAGE_AUX_MASK)){',
    ]),
  )
  const grant = changed(off.grantPages, on.grantPages)
  assert.deepEqual(
    grant.removed,
    SORTED([
      'let requestFine=requestWord&VSM_PAGE_FINE;',
      'vsmPageTableStore(entryIndex,vsmPackTableEntry(poolPageXY,true));',
    ]),
  )
  assert.deepEqual(
    grant.added,
    SORTED([
      'let requestFine=requestWord&VSM_PAGE_AUX_MASK;',
      'vsmPageTableStore(entryIndex,vsmPackSecondaryTableEntry(poolPageXY,(requestFine&VSM_PAGE_SECONDARY)!=0u));',
    ]),
  )
})

/** The storage buffers of a program: the declarations of its bindings. */
const storage = (code: string) => (code.match(/var<storage/g) ?? []).length

test('the programs bind no more storage buffers than they did, and the new ones few', () => {
  for (const stats of [false, true]) {
    const [off, on] = [programs(OFF, stats), programs(ON, stats)]
    for (const name of Object.keys(off))
      if (name !== 'selectMerges') assert.equal(storage(on[name]), storage(off[name]), name)
    // The selection lists the filtered pages: the arguments, the lists, the records of the maps.
    assert.deepEqual([storage(off.selectMerges), storage(on.selectMerges)], [3, 6])
  }
  // The propagation: the records, the requests, the cover and the per-page ids.
  assert.equal(storage(vsmFilterableKernels(ON).propagateFilterable.code), 4)
})
