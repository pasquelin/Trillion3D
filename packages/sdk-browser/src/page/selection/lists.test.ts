// The two cut lists are not cleared with
// `length = 0` each frame — they would lose their capacity and grow it back from zero to
// eighty thousand — but rewritten by index, their length set once at the end.
// What must stay true: a cut shorter than the previous one leaves nothing behind.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { type PageRec } from './selection.ts'
import { selectVisiblePages } from '../cut/cut.fixture.ts'
import { wideCamera } from './dag.fixture.ts'
import { culledDagRoots, HELD_EXACT_ASK } from './helpers.fixture.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'

/** A camera that sees none of the model: its cut is empty. */
function ailleurs() {
  const cam = G.perspectiveCamera(20, 16 / 9, 0.1, 1000)
  cam.position.set(1000, 1000, 1000)
  cam.lookAt(2000, 2000, 2000)
  cam.updateMatrixWorld()
  return cam
}

test('reused lists keep nothing from the previous cut, shorter or empty', () => {
  const { fixture, roots } = culledDagRoots()
  const shown: PageRec[] = [],
    wanted: PageRec[] = []
  const large = selectVisiblePages(
    roots,
    engineCamera(wideCamera()),
    { ...HELD_EXACT_ASK, wanted },
    shown,
  )
  const full = large.shown.length
  assert.ok(full > 0)
  assert.equal(large.wanted.length, full)

  const empty = selectVisiblePages(
    roots,
    engineCamera(ailleurs()),
    { ...HELD_EXACT_ASK, wanted },
    shown,
  )
  assert.equal(empty.shown.length, 0)
  assert.equal(empty.wanted.length, 0)
  assert.equal(shown.length, 0)
  assert.equal(wanted.length, 0)
  // Neither hole nor leftover: what the host walks is exactly this frame's cut.
  assert.deepEqual([...shown], [])
  assert.equal(empty.selectedTriangles, 0)
  assert.equal(empty.displayedTriangles, 0)

  // And the list returns to its full length without keeping a trace of the empty pass.
  const encore = selectVisiblePages(
    roots,
    engineCamera(wideCamera()),
    { ...HELD_EXACT_ASK, wanted },
    shown,
  )
  assert.equal(encore.shown.length, full)
  assert.deepEqual(
    encore.shown.map((page) => page.url),
    large.shown.map((page) => page.url),
  )
  assert.ok(encore.shown.every((page) => page !== undefined))
  fixture.geometry.dispose()
})
