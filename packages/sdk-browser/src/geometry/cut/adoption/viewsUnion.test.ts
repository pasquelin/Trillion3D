// The residency holds the union of the views' cuts, each page asked for once, and a single view
// publishes exactly what it publishes alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuCutPublication } from './publication.ts'
import { keysOf, queueOf, rec, world } from '../../residency/sets.fixture.ts'
import { createWebgpuRunState } from '../../../frame/backend/state/runState.ts'
import { createWebgpuGpuState } from '../../../frame/backend/state/gpu.ts'
import { createWebgpuVisState } from '../../../frame/backend/state/vis.ts'
import {
  createWebgpuView,
  createWebgpuViews,
  type WebgpuView,
} from '../../../frame/backend/state/view.ts'
import { useWebgpuView } from '../../../frame/backend/state/viewSwitch.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import type { GpuCut } from '../../../gpu/core/selection.ts'
import { copySelectionUniforms, sameSelectionUniforms } from '../../../gpu/core/selectionCopy.ts'
import { createSelectionUniforms } from '../../../gpu/core/selection.ts'
import { holdViewFilter, writeViewFilter } from '../../dag/viewFilterRegion.ts'
import { createScaleControl } from '../../../frame/scale/scaleControl.ts'

/** Eight pages, levels 0 to 3 twice over. */
const eightPages = () => world(Array.from({ length: 8 }, (_, i) => rec(`p${i}`, i % 4)))

/** Eight pages published through one publication and real sets, on the runtime groups the view
 *  switch trades; each view's readback is the one its `draw` hands, its ids in the order the GPU's
 *  threads wrote them. */
function bench() {
  const scene = eightPages()
  const run = createWebgpuRunState(),
    gpu = createWebgpuGpuState([1, 1]),
    vis = createWebgpuVisState(),
    setup = { viewport: [1, 1] as [number, number] }
  const capture = { capturing: false },
    timing = {}
  const rt = {
    capture,
    run,
    gpu,
    vis,
    setup,
    timing,
    views: createWebgpuViews(
      { run, gpu, vis, setup, timing } as unknown as WebgpuPagesRuntime,
      createScaleControl(1),
    ),
    layout: {
      packedPages: scene.packed,
      recordOf: (packed: number) => scene.packed[packed],
      gpuWanted: [],
      selectionRoots: [],
      clusters: { watchTouched: () => {} },
    },
  } as unknown as WebgpuPagesRuntime
  // The main view reads its readback off the GPU cut, which claims no rank: a hashed difference.
  let mainCut: GpuCut | null = null
  run.gpuSelection = {
    peek: () => mainCut,
    adopt: () => undefined,
    worldRevision: 0,
  } as unknown as typeof run.gpuSelection
  const publication = createWebgpuCutPublication(rt, scene.sets, scene.closure)
  const { main } = rt.views,
    side = createWebgpuView(1, 1)
  // A view the page draws beside the main one: its readbacks join the union (`viewReadbacks`).
  rt.views.persistent.push(side)
  /** `view` draws the pages `ids` name: its readback lands and is adopted. */
  const draw = (view: WebgpuView, ids: number[]) => {
    useWebgpuView(rt, view)
    const cut = {
      uniforms: copySelectionUniforms(rt.run.selectionUniforms),
      result: {
        pageIds: ids,
        requests: { pages: ids, counts: ids.map(() => 1), priorities: ids.map(() => 1) },
        drawablePageIds: ids,
        frustumRejected: 0,
        lodLevel: 0,
        occluded: 0,
        postHidden: 0,
        selectedTriangles: 0,
        transparentTriangles: 0,
      },
      worldRevision: 0,
    } as GpuCut
    if (view === main) mainCut = cut
    else rt.run.asideCut = { peek: () => cut } as unknown as typeof rt.run.asideCut
    publication.adoptViewCut()
  }
  const keys = (ids: number[]) => new Set(ids.map((id) => scene.tracking.keyOf(scene.packed[id])))
  return { ...scene, publication, main, side, draw, keys }
}

test('a second view keeps its pages while the main view draws, each asked for once', () => {
  const { sets, tracking, publication, main, side, draw, keys, stream } = bench()
  draw(main, [0, 1, 2, 3])
  draw(side, [1, 4, 5, 6, 7])
  draw(main, [0, 1])
  assert.deepEqual(keysOf(tracking.keep), keys([0, 1, 4, 5, 6, 7]), 'the union is kept')
  assert.equal(sets.requestedCount, 6, 'a page both views draw is asked for once')
  stream()
  assert.deepEqual(keysOf(tracking.wanted), keys([0, 1, 4, 5, 6, 7]), 'the pool takes the union')
  publication.releaseView(side)
  stream()
  assert.deepEqual(keysOf(tracking.keep), keys([0, 1]), 'a view released lets its pages go')
  assert.deepEqual(keysOf(tracking.wanted), keys([0, 1]))
})

test('one view asks and keeps what it did before views existed', () => {
  const { sets, tracking, main, draw, stream } = bench()
  // The contract of a single view: the cut's records, one difference, the sets, the streaming.
  const before = eightPages()
  const cuts = [[0, 1, 2, 3], [2, 3, 4, 5, 6], [], [1, 3, 5, 7], [7]]
  for (const ids of cuts) {
    draw(main, ids)
    before.delta.adoptRecords(
      ids.map((id) => before.packed[id]),
      (rec) => before.packed.indexOf(rec),
    )
    before.cut()
    before.sets.applyDrawn(before.delta)
    stream()
    before.stream()
    assert.deepEqual(
      queueOf(tracking.wanted),
      queueOf(before.tracking.wanted),
      `cut ${ids}: the pages taken on, in their order`,
    )
    assert.deepEqual(keysOf(tracking.keep), keysOf(before.tracking.keep))
    assert.equal(sets.requestedCount, before.sets.requestedCount)
  }
})

test('a cut stands for another view’s only under the same plane and the same filter', () => {
  const a = createSelectionUniforms(),
    b = copySelectionUniforms(a)
  assert.equal(sameSelectionUniforms(a, b), true)
  // A plane of zeros and no plane are the one view; another plane, or a filter, is another.
  b.clipPlane = [0, 0, 0, 0]
  assert.equal(sameSelectionUniforms(a, b), true)
  b.clipPlane = [0, 0, 1, 2]
  assert.equal(sameSelectionUniforms(a, b), false)
  const kept = copySelectionUniforms(b)
  b.clipPlane[3] = 9
  assert.deepEqual(kept.clipPlane, [0, 0, 1, 2], 'the copy is its own')
  assert.equal(sameSelectionUniforms(a, kept), false)
  const bits = new Uint32Array(1)
  a.filter = bits
  assert.equal(sameSelectionUniforms(a, copySelectionUniforms(a)), true, 'by identity')
  assert.equal(sameSelectionUniforms(a, { ...a, filter: new Uint32Array(1) }), false)
  assert.equal(sameSelectionUniforms(a, { ...a, filter: undefined }), false)
})

test('the filter’s bits go up when the region does not hold them, once, and are never sent for a view without', () => {
  const writes: { offset: number; bytes: number }[] = []
  const resources = {
    device: {
      queue: {
        writeBuffer: (_b: unknown, offset: number, _d: unknown, _o: number, bytes: number) =>
          void writes.push({ offset, bytes }),
      },
    },
    work: {},
    workLayout: { filter: 100, words: 102 },
    filterHeld: { bits: undefined as Uint32Array | undefined },
  } as unknown as Parameters<typeof writeViewFilter>[0]
  const mine = new Uint32Array(2),
    theirs = new Uint32Array(2)
  writeViewFilter(resources, undefined)
  assert.deepEqual(writes, [], 'a view without a filter sends nothing')
  writeViewFilter(resources, mine)
  writeViewFilter(resources, mine)
  assert.deepEqual(writes, [{ offset: 400, bytes: 8 }], 'once, at the layout’s word')
  writeViewFilter(resources, theirs)
  writeViewFilter(resources, mine)
  assert.equal(writes.length, 3, 'a view that cuts after another sends its own again')
  // Bits past the room the region has are not sent.
  writeViewFilter(resources, new Uint32Array(5))
  assert.deepEqual(writes[3], { offset: 400, bytes: 8 })
})

test('a reader beside the cut holds a view’s bits where the cut reads them, none for a view without or a cut with no room', () => {
  const writes: number[] = []
  const work = {} as GPUBuffer
  const resources = (words: number) =>
    ({
      device: { queue: { writeBuffer: (_b: unknown, offset: number) => void writes.push(offset) } },
      work,
      workLayout: { filter: 100, words },
      filterHeld: { bits: undefined as Uint32Array | undefined },
    }) as unknown as Parameters<typeof holdViewFilter>[0]
  const bits = new Uint32Array(2),
    room = resources(102)
  assert.equal(holdViewFilter(room, undefined), undefined)
  assert.deepEqual(holdViewFilter(room, bits), { buffer: work, base: 100 })
  assert.deepEqual(holdViewFilter(room, bits), { buffer: work, base: 100 })
  assert.deepEqual(writes, [400], 'sent once')
  assert.equal(holdViewFilter(resources(100), bits), undefined, 'a cut with no room for them')
})
