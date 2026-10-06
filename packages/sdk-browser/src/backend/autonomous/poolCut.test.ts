// The WebGL2 image under its geometry pool (`imageCut.ts`, `pool.ts`, `requests.ts`): the cut is
// drawn at the host's threshold whatever the budget, the pool bounds what the image asks for, and
// the cut rule draws the nearest resident ancestor of what the pool does not hold.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PAGE } from './pool.fixture.ts'
import { mount } from './poolCut.fixture.ts'
import { dag0Roots, descend, strip, wholeStrip } from './poolStrip.fixture.ts'
import { coverFault } from '../../page/cut/cutRule.fixture.ts'
import { dagCamera } from '../../../../../bench/perf/browser/support/dagCut.ts'

test('a smaller budget bounds what the image asks for and holds, never its threshold', () => {
  const { pool, state, diagnostics, image, drawn, wanted } = mount(1000 * PAGE)
  for (let frame = 0; frame < 12; frame++) image(1)
  const fine = drawn(),
    asked = wanted()
  assert.ok(state.allocationBytes > 40 * PAGE, `a fine cut to shrink: ${fine} pages`)
  assert.equal(pool.coverageBudgetLimited, false, 'a cut the budget did not limit')
  pool.resize(20 * PAGE)
  // Every image, the first to see the smaller budget included, releases what it no longer asks
  // for before its cut draws their ancestors.
  for (let frame = 0; frame < 12; frame++) {
    const most = image(1)
    assert.ok(most <= 20 * PAGE, `image ${frame}: ${most / PAGE} pages for 20 slots`)
    assert.equal(wanted(), asked, `image ${frame}: the cut is still the host's`)
    assert.equal(pool.coverageBudgetLimited, true, 'the verdict moves in the image that asked')
  }
  assert.ok(drawn() < fine, 'the pages the pool does not hold are drawn by their ancestors')
  assert.equal(
    diagnostics.filter(({ phase }) => phase === 'coverage-budget').length,
    0,
    'the verdict waits for the flush',
  )
  pool.flush()
  pool.flush()
  const published = diagnostics.filter(({ phase }) => phase === 'coverage-budget')
  assert.equal(published.length, 1, 'the verdict is published once, when it changes')
  assert.equal(published[0].context?.limited, true)
  assert.equal(published[0].context?.pixelError, 1, "the host's threshold")
  assert.ok((published[0].context?.requiredSlots as number) > 20, 'what the image asked, counted')
  // A larger budget brings the detail back as the pages arrive.
  pool.resize(400 * PAGE)
  for (let frame = 0; frame < 12; frame++) image(1)
  assert.ok(state.allocationBytes <= 400 * PAGE)
  assert.equal(pool.coverageBudgetLimited, false)
  assert.equal(drawn(), fine, 'the same cut as before the budget changed')
  pool.flush()
  const back = diagnostics.filter(({ phase }) => phase === 'coverage-budget')
  assert.equal(back.length, 2)
  assert.equal(back[1].context?.limited, false)
})

test('group-mates past the frustum are asked for: the image converges to the cut it wants', () => {
  // Nine units above the strip's start: the frustum cuts the strip, and the groups across it.
  const { image, cut, frame, requested, pages } = strip(1000, dagCamera(9))
  for (let i = 0; i < 16; i++) image(0.25)
  const { shown, wanted } = cut()
  assert.ok(wanted.length > 4, `${wanted.length} pages wanted`)
  assert.equal(frame.stand, 0, 'no ancestor stands in for a wanted page any more')
  assert.deepEqual(new Set(shown), new Set(wanted), 'the cut draws what it wants')
  const asked = new Set(requested.map((page) => page.url))
  assert.ok(
    pages.some((page) => asked.has(page.url) && !wanted.includes(page as never)),
    'group-mates the view does not keep are asked for with the pages it wants',
  )
})

test('a pool at the root cover plus a tenth draws every leaf once, and never a hole', () => {
  const { image, dag, drawnIds } = strip(Math.ceil(dag0Roots() * 1.1), wholeStrip())
  for (let i = 0; i < 24; i++) {
    image(0.25, 3)
    assert.equal(coverFault(dag, drawnIds()), -1, `image ${i}: a leaf not covered exactly once`)
  }
})

// The WebGL2 image publishes its holes from the cut it takes. A missing fine page is drawn
// by its ancestor, no hole; a missing root-cover page has nothing coarser, and its triangles read
// uncovered — the reading the no-hole proof takes under WebGL2.
test('the image cut counts as uncovered only a surface nothing resident draws', () => {
  const { image, cut, dag, pages, drawnIds, drop } = strip(1000, wholeStrip())
  for (let i = 0; i < 24; i++) image(0.25)
  assert.equal(cut().uncoveredTriangles, 0, 'a full view has no hole')
  const fine = pages.find((page) => page.parentError !== null && page.array)!
  drop(fine.url)
  image(0.25, 0)
  assert.equal(coverFault(dag, drawnIds()), -1, 'an ancestor stands in for the missing page')
  assert.equal(cut().uncoveredTriangles, 0, 'a covered surface is no hole')
  const root = pages.find((page) => page.parentError === null)!
  drop(root.url)
  image(0.25, 0)
  assert.notEqual(coverFault(dag, drawnIds()), -1, 'the surface under the root is not drawn')
  assert.equal(cut().uncoveredTriangles, root.triangles, 'its triangles read uncovered')
})

// A budget cut mid-session — to about half the fine cut, and down to the starvation run's root
// cover plus a tenth — is paid one level per image: every page an image drew survives to the next
// cut, the residency holds the ancestors each surface falls back to, and the pool converges.
for (const [label, budget] of [
  ['half the fine cut', 30],
  ['the root cover and a tenth', Math.ceil(dag0Roots() * 1.1)],
] as const)
  test(`a budget cut to ${label}: no hole, drawn pages kept, one level coarser per image`, () => {
    const run = strip(1000, wholeStrip()),
      { image, pool, state } = run
    for (let i = 0; i < 24; i++) image(0.25)
    pool.resize(budget * PAGE)
    descend(run)
    // Under its floor — the root cover and the pages its groups replace — the pool holds that.
    assert.ok(state.allocationBytes <= pool.held.allocatedBytes, 'the pool converged to its budget')
  })

// At the smallest budget the pool still holds its floor — the root cover and the pages its
// groups replace —, and admits those first: a root whose error the view refuses is replaced by
// them, a root drawn only where the view accepts it, and every surface still drawn once.
test('at the smallest budget no root the view refuses is drawn, and no hole', () => {
  const { image, pool, cut, dag, drawnIds } = strip(1000, wholeStrip())
  pool.resize(1)
  for (let i = 0; i < 24; i++) image(0.25)
  const { shown, wanted } = cut()
  const refused = shown.filter((page) => page.parentError == null && !wanted.includes(page))
  assert.deepEqual(refused, [], 'every root the view refuses is replaced')
  assert.equal(coverFault(dag, drawnIds()), -1, 'every leaf is drawn once')
})
