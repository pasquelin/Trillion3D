// The residency holds the union of the views' cuts, under the one
// page budget, and a single view publishes exactly what it publishes alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuCutPublication } from './publication.ts'
import { admissionOrder, keysOf, queueOf, rec, world } from '../residency/sets.fixture.ts'
import { createWebgpuRunState } from '../pages/state/run.ts'
import { createWebgpuGpuState } from '../pages/state/gpu.ts'
import { createWebgpuVisState } from '../pages/state/vis.ts'
import { createWebgpuView, createWebgpuViews, type WebgpuView } from '../pages/state/view.ts'
import { useWebgpuView } from '../pages/state/viewSwitch.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { type GpuCut } from '../../gpu/core/selection.ts'
import { copySelectionUniforms } from '../../gpu/core/selectionCopy.ts'

/** Eight pages, levels 0 to 3 twice over. */
const eightPages = () => world(Array.from({ length: 8 }, (_, i) => rec(`p${i}`, i % 4)))

/** Eight pages published through one publication and real sets, on the runtime groups the view
 *  switch trades; each view's readback is the one its `draw` hands, ranked as the GPU ranks a short
 *  pool's requests. */
function bench() {
  const scene = eightPages()
  const run = createWebgpuRunState(),
    gpu = createWebgpuGpuState([1, 1]),
    vis = createWebgpuVisState(),
    setup = { viewport: [1, 1] as [number, number] }
  const aheadOffers: number[][] = []
  const ahead = {
    hostBytes: 0,
    offerIds: (ids: ArrayLike<number>) => aheadOffers.push(Array.from(ids)),
  }
  const capture = { capturing: false }
  const rt = {
    capture,
    run,
    gpu,
    vis,
    setup,
    views: createWebgpuViews({ run, gpu, vis, setup } as unknown as WebgpuPagesRuntime),
    layout: {
      packedPages: scene.packed,
      recordOf: (packed: number) => scene.packed[packed],
      gpuWanted: [],
      selectionRoots: [],
      rows: { watchTouched: () => {} },
    },
  } as unknown as WebgpuPagesRuntime
  // The main view reads its readback off the GPU cut, which claims no rank: a hashed difference.
  let mainCut: GpuCut | null = null
  run.gpuSelection = {
    peek: () => mainCut,
    adopt: () => undefined,
    worldRevision: 0,
  } as unknown as typeof run.gpuSelection
  const publication = createWebgpuCutPublication(rt, scene.sets, scene.closure, {
    all: [ahead],
    ahead,
  })
  const { main } = rt.views,
    side = createWebgpuView(1, 1)
  // A view the page draws beside the main one: its readbacks join the union (`viewReadbacks`).
  rt.views.persistent.push(side)
  /** `view` draws the pages `ids` name: its readback lands and is adopted. */
  const draw = (view: WebgpuView, ids: number[]) => {
    useWebgpuView(rt, view)
    const pageIds = admissionOrder(ids, scene.packed, scene.tracking.topLevel)
    const cut = {
      uniforms: copySelectionUniforms(rt.run.selectionUniforms),
      result: {
        pageIds,
        drawablePageIds: pageIds,
        frustumRejected: 0,
        lodLevel: 0,
        selectedTriangles: 0,
        drawnTriangles: 0,
        transparentTriangles: 0,
      },
      worldRevision: 0,
    } as GpuCut
    if (view === main) mainCut = cut
    else rt.run.asideCut = { peek: () => cut } as unknown as typeof rt.run.asideCut
    publication.adoptViewCut()
  }
  /** The admission at `room` of every view's readback, true past it. */
  const budget = (room: number) => {
    const short = scene.admission.short(room)
    scene.admission(room, publication.viewReadbacks())
    return short
  }
  const keys = (ids: number[]) => new Set(ids.map((id) => scene.tracking.keyOf(scene.packed[id])))
  return { ...scene, publication, capture, main, side, draw, budget, keys, aheadOffers }
}

test('a second view keeps its pages while the main view draws, all under the one budget', () => {
  const { sets, tracking, publication, main, side, draw, keys, budget } = bench()
  draw(main, [0, 1, 2, 3])
  draw(side, [1, 4, 5, 6, 7])
  draw(main, [0, 1])
  assert.deepEqual(keysOf(tracking.keep), keys([0, 1, 4, 5, 6, 7]), 'the union is kept')
  assert.equal(sets.requestedCount, 6, 'a page both views draw is asked for once')
  assert.equal(budget(3), true, 'the union overruns the budget')
  assert.equal(tracking.wanted.count, 3, 'the budget is the one budget, never one per view')
  // Levels 3 and 2 whole; of level 1, the page the queue in place held first (the union's own
  // order, followed whole before the pool turned short): no slot traded at the turn.
  assert.deepEqual(keysOf(tracking.wanted), keys([7, 6, 5]), 'the coarsest pages of the union')
  publication.releaseView(side)
  budget(3)
  assert.deepEqual(keysOf(tracking.keep), keys([0, 1]), 'a view released lets its pages go')
  assert.deepEqual(keysOf(tracking.wanted), keys([0, 1]))
})

test('under budget pressure a capture keeps the detail pages it kept alone', () => {
  const { tracking, publication, capture, main, side, draw, keys, budget } = bench()
  /** The pages `ids` keep at `room` when their view is the only one. */
  const alone = (ids: number[], room: number) => {
    const only = eightPages()
    only.delta.apply(ids)
    only.cut()
    only.budget(room)
    return keysOf(only.tracking.wanted)
  }
  const kept = (ids: number[]) => [...keys(ids)].filter((key) => tracking.wanted.has(key))
  draw(main, [0, 1, 2, 3])
  capture.capturing = true
  draw(side, [4, 5, 6, 7])
  budget(3)
  assert.equal(kept([4, 5, 6, 7]).length, 3, 'the capture keeps as many pages as alone')
  assert.deepEqual(keysOf(tracking.wanted), alone([4, 5, 6, 7], 3), 'the same pages')
  capture.capturing = false
  publication.releaseView(side)
  draw(main, [0, 1, 2, 3])
  budget(3)
  assert.deepEqual(keysOf(tracking.wanted), alone([0, 1, 2, 3], 3), 'the main view, as alone')
})

test('a persistent view and the main one rank the one union, whichever is drawn', () => {
  const { tracking, sets, main, side, draw, keys, budget } = bench()
  draw(main, [0, 1, 2, 3])
  draw(side, [4, 5, 6, 7])
  budget(3)
  const queue = keysOf(tracking.wanted),
    revision = sets.acceptedRevision
  for (let frame = 0; frame < 3; frame++) {
    draw(main, [0, 1, 2, 3])
    budget(3)
    draw(side, [4, 5, 6, 7])
    budget(3)
  }
  assert.deepEqual(keysOf(tracking.wanted), queue, 'views drawn every frame never trade slots')
  assert.equal(sets.acceptedRevision, revision, 'the queue is never ranked to other pages')
  assert.deepEqual(queue, keys([7, 3, 2]), 'the coarsest pages of the union, as on develop')
})

test("another view's cut leaves the main view's pages ahead alone", () => {
  const { main, side, draw, aheadOffers } = bench()
  draw(main, [0])
  const offers = aheadOffers.length
  draw(side, [4])
  assert.equal(aheadOffers.length, offers, 'the view ahead is the main view’s own')
})

test('one view asks, keeps and ranks what it did before views existed', () => {
  const { sets, tracking, main, draw, budget } = bench()
  // The contract of a single view: the cut's records, one difference, the sets, the budget.
  const before = eightPages()
  const cuts = [[0, 1, 2, 3], [2, 3, 4, 5, 6], [], [1, 3, 5, 7], [7]]
  for (const ids of cuts) {
    draw(main, ids)
    before.delta.adoptRecords(
      admissionOrder(ids, before.packed, before.tracking.topLevel).map((id) => before.packed[id]),
      (rec) => before.packed.indexOf(rec),
    )
    before.cut()
    before.sets.applyDrawn(before.delta)
    for (const room of [2, 64]) {
      budget(room)
      before.budget(room)
      assert.deepEqual(
        queueOf(tracking.wanted),
        queueOf(before.tracking.wanted),
        `cut ${ids}, room ${room}: the queue, in its order`,
      )
      assert.deepEqual(keysOf(tracking.keep), keysOf(before.tracking.keep))
      assert.equal(sets.requestedCount, before.sets.requestedCount)
    }
  }
})
