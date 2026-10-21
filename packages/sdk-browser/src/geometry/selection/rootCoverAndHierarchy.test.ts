import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { rootCoverage } from './selection.ts'
import { selectVisiblePages } from '../cut/cut.fixture.ts'
import { collectFixture, dagFixture, wideCamera, urls } from './dag.fixture.ts'
import { dagCulling } from './helpers.fixture.ts'
import { CULL_FIRST_PAGE, CULL_STRIDE } from '../dag/types.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import type { PageRec } from './types.ts'

test('the root cover is what stays pinned for a flat cut', () => {
  const fixture = dagFixture()
  const { roots } = collectFixture(fixture)
  assert.deepEqual(
    rootCoverage(roots).map((page) => page.url),
    ['root'],
  )
  fixture.geometry.dispose()
})

test('a page whose replacement error sits below its own error is rejected at load time', () => {
  const fixture = dagFixture()
  fixture.metadata.primitives[0].pages[4].parentError = 0.001
  assert.throws(() => collectFixture(fixture), /parentError below lodError/)
  fixture.metadata.primitives[0].pages[4].parentError = 0.2
  fixture.metadata.primitives[0].pages[4].parentSphere = null
  assert.throws(() => collectFixture(fixture), /parentError without parentSphere/)
  fixture.geometry.dispose()
})

test('the culling hierarchy accelerates the flat cut without changing it', () => {
  const plain = dagFixture(),
    accelerated = dagFixture()
  accelerated.metadata.primitives[0].culling = dagCulling()
  const cam = wideCamera()
  for (const pixelError of [0, 1, 3.4, 3.6, 20, 60, 200, 1e6]) {
    const a = urls(plain, pixelError, cam),
      b = urls(accelerated, pixelError, cam)
    assert.deepEqual(b, a, `pixelError ${pixelError}`)
  }
  // The leaf subtree must actually be skipped once its replacement error fits the budget.
  const { roots } = collectFixture(accelerated)
  assert.ok(roots[0].culling, 'the hierarchy must be unpacked')
  const coarse = selectVisiblePages(roots, engineCamera(cam), {
    pixelError: 20,
    viewport: [1280, 720],
  })
  assert.deepEqual(coarse.shown.map((page) => page.url).sort(), ['mid-left', 'mid-right'])
  plain.geometry.dispose()
  accelerated.geometry.dispose()
})

test('a culling hierarchy that does not match its pages is rejected', () => {
  const fixture = dagFixture()
  const broken = dagCulling()
  broken.nodes[CULL_STRIDE + CULL_FIRST_PAGE] = 99 // the leaf child now claims pages past the end
  fixture.metadata.primitives[0].culling = broken
  assert.throws(() => collectFixture(fixture), /culling/i)
  const short = dagCulling()
  short.count = 4
  fixture.metadata.primitives[0].culling = short
  assert.throws(() => collectFixture(fixture), /culling/i)
  fixture.geometry.dispose()
})

// An opaque page records it too: its material may turn blended in the session, and then
// draws in the order a blended compile records.
for (const transparent of [true, false])
  test(`${transparent ? 'transparent' : 'opaque'} flat pages keep a draw order taken from their source rank`, () => {
    const fixture = dagFixture()
    fixture.mesh.material = G.basicSurface({ transparent })
    for (const page of fixture.metadata.primitives[0].pages) page.start = (6 - page.id) * 3
    const { allPages } = collectFixture(fixture)
    assert.deepEqual(
      allPages.map((page) => page.sourceOrder),
      [18, 15, 12, 9, 6, 3, 0],
    )
    fixture.geometry.dispose()
  })

test('every root is covered, a held one with its holder', () => {
  const pages = [
    { url: 'top', parentError: null },
    { url: 'held', parentError: null, holder: 1 },
    { url: 'child', parentError: 1 },
    { url: 'heldChild', parentError: 1 },
  ] as unknown as PageRec[]
  const covered = rootCoverage([{ pages }])
  assert.deepEqual(
    covered.map((page) => [page.url, page.holder]),
    [
      ['top', undefined],
      ['held', 1],
    ],
  )
  const none = pages.map((page) => ({ ...page, parentError: 1 }))
  assert.throws(() => rootCoverage([{ pages: none }]), /INVALID_ROOT_COVERAGE/)
})
