// The scene the row-cache proofs cut on Dawn: the cut-rule DAG placed many times, a row cache over
// every instance far smaller than them, each instance's bytes resident; and the loop that cuts with
// the shipped kernel, follows its readback in the row cache and syncs it until the drawn cut is the
// one the view wants (`row-cache.gpu.ts`, `row-owner.gpu.ts`).
import { slotTable } from '../../../packages/sdk-browser/src/webgpu/row/pageState.fixture.ts'
import { rootOfPacked } from '../../../packages/sdk-browser/src/page/selection/placements.ts'
import { rowGpu } from '../../../packages/sdk-browser/src/webgpu/row/rowCache.fixture.ts'
import { createGroupClosure } from '../../../packages/sdk-browser/src/page/cut/groupClosure.ts'
import { createWebgpuRowState } from '../../../packages/sdk-browser/src/webgpu/row/state.ts'
import { createWebgpuRowSync } from '../../../packages/sdk-browser/src/webgpu/row/sync.ts'
import { ROW_WORDS } from '../../../packages/sdk-browser/src/visibility/types.ts'
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts'
import { BufferAttribute } from '../../../packages/sdk-core/src/world/buffer/attribute.ts'
import { openSelectionKernel } from '../dag/selectionKernel.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { pageAddress } from '../../../packages/sdk-browser/src/webgpu/row/pageSlots.ts'
import { placedRuleDag } from '../kit/placedRuleDag.ts'

/** Placements apart along -x: one view sees one of them. */
const SPACING = 1e4

/** `copies` placements of the DAG, the one the strip camera sees packed last; the row cache of
 *  `table` rows over their instances, every one's bytes resident, each row's record naming its
 *  page (`page + 1` in its first word) and marking the row dirty, as the shipped writer does. */
export function rowCacheScene(
  copies: number,
  table: number,
  /** What a request no free row serves asks the cut for: a queue of the rows' victims. */
  askOrder?: () => void,
) {
  const { dag, roots, placement, packed, view } = placedRuleDag(copies, SPACING, 64, (placed) => {
    for (const root of placed.reverse())
      root.pages = root.pages.map((page) => ({
        ...page,
        array: Uint32Array.of(0, 1, 2),
        // The three corners the indices name.
        attributes: { position: new BufferAttribute(new Float32Array(9), 3) },
      }))
    return placed
  })
  const pages = roots.flatMap((root) => root.pages) as PageRec[]
  const slots = slotTable()
  const rows = createWebgpuRowState(pages, table, 0, undefined, slots.read)
  rows.pageTableFloats = new Float32Array(table * ROW_WORDS)
  rows.pageTableInts = new Uint32Array(rows.pageTableFloats.buffer)
  pages.forEach((_, page) => {
    slots.set(pageAddress(pages[page]), page * 16)
    rows.touchPage(page)
  })
  // The host's frame, which each round advances: the clock the rows' use is stamped with.
  const clock = { frame: 100 }
  const sync = createWebgpuRowSync(
    rows,
    { sync: () => {}, dirty: true },
    pages,
    () => true,
    // The shipped writer's contract (`createPageRowWriter`): the row written, then declared dirty —
    // the mark every reader of a rewritten row follows.
    (_rec, page, row, _offset, _floats, ints) => {
      ints[row * ROW_WORDS] = page + 1
      rows.markRowDirty(row)
    },
    () => createGroupClosure(roots, placement, pages, true),
    undefined,
    undefined,
    undefined,
    () => clock.frame,
    askOrder,
  )
  // The rows' closure and queue each cut ranks (`rowEviction.ts`), by their CPU twins on the
  // kernel's lists: each placement's own rows, through its groups.
  const gpu = rowGpu(
    sync,
    rows,
    roots.map((root, w) => ({ pageBase: placement.baseOfRoot[w], structure: root.structure })),
    (page) => rootOfPacked(placement, page),
  )
  /** The view of the placement `back` places behind the one packed last: the strip camera slid
   *  along -x. */
  const viewBack = (back = 0) => view(-back * SPACING)
  /** The first packed instance of the placement `back` behind the one packed last. */
  const base = (back = 0) => placement.baseOfRoot[roots.length - 1 - back]
  return {
    ...{ rows, sync, packed, view: viewBack, base, clock, gpu, roots, placement, pages },
    ...{ pagesPer: dag.pages.length, instances: pages.length },
    /** Each page of the DAG's leaf units: what a cut covers. */
    units: dag.pages.map((page) => page.units),
  }
}

/** Cuts the view `back` and follows until the drawn cut is the wanted one, `rounds` readbacks at
 *  most, every round on one device and one build of the kernel; returns what it settled on. */
export function settleView(scene: ReturnType<typeof rowCacheScene>, back = 0, rounds = 8) {
  const { rows, sync, packed, clock, gpu } = scene
  const uniforms = scene.view(back)
  return runOnDawn(async () => {
    const kernel = await openSelectionKernel()
    clock.frame++
    sync.syncRows(false)
    let drawn: number[] = [],
      wanted: number[] = []
    for (let round = 0; round < rounds; round++) {
      const resident = Uint8Array.from({ length: packed.pageCount }, (_, p) => rows.residentFlag(p))
      const reading = await kernel.cut({ name: `round ${round}`, packed, uniforms, resident })
      ;({ drawn, pages: wanted } = reading)
      if (drawn.join() === wanted.join()) break
      gpu(clock.frame, [...drawn, ...reading.requests])
      sync.followCut({ result: { pageIds: reading.requests } })
      clock.frame++
      sync.syncRows(false)
    }
    await kernel.close()
    return { drawn, wanted }
  }, undefined)
}
