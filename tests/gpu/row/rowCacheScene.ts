// The scene the row-cache proofs cut on Dawn: the cut-rule DAG placed many times, a row cache over
// every instance far smaller than them, each instance's bytes resident; and the loop that cuts with
// the shipped kernel, follows its readback in the row cache and syncs it until the drawn cut is the
// one the view wants (`row-cache.gpu.ts`, `row-owner.gpu.ts`).
import { ruleDag } from '../../../packages/sdk-browser/src/page/cut/cutRule.fixture.ts'
import {
  placements,
  stripCamera,
} from '../../../packages/sdk-browser/src/page/cut/cutRuleBackends.fixture.ts'
import { postPackedBases } from '../../../packages/sdk-browser/src/page/selection/placements.ts'
import { createGroupClosure } from '../../../packages/sdk-browser/src/page/cut/groupClosure.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { writeEngineCamera } from '../../../packages/sdk-browser/src/camera/engineCamera.ts'
import { createWebgpuRowState } from '../../../packages/sdk-browser/src/webgpu/row/state.ts'
import { createWebgpuRowSync } from '../../../packages/sdk-browser/src/webgpu/row/sync.ts'
import { PAGE_INFO_STRIDE } from '../../../packages/sdk-browser/src/visibility/buffer.ts'
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts'
import { BufferAttribute } from '../../../packages/sdk-core/src/world/buffer/attribute.ts'
import { openSelectionKernel } from '../dag/selectionKernel.ts'
import { runOnDawn } from '../kit/onDawn.ts'

/** Words of one page-table row: the record writer below names its page in the first. */
export const ROW_WORDS = PAGE_INFO_STRIDE / 4
/** Placements apart along -x: one view sees one of them. */
export const SPACING = 1e4

/** `copies` placements of the DAG, the one the strip camera sees packed last; the row cache of
 *  `table` rows over their instances, every one's bytes resident, each row's record naming its
 *  page (`page + 1` in its first word) and marking the row dirty, as the shipped writer does. */
export function rowCacheScene(copies: number, table: number) {
  const dag = ruleDag(64)
  const roots = placements(dag, copies, SPACING).reverse()
  for (const root of roots)
    root.pages = root.pages.map((page) => ({
      ...page,
      array: Uint32Array.of(0, 1, 2),
      // The three corners the indices name.
      attributes: { position: new BufferAttribute(new Float32Array(9), 3) },
    }))
  const placement = postPackedBases(roots)
  const pages = roots.flatMap((root) => root.pages) as PageRec[]
  const closure = createGroupClosure(roots, placement, pages)
  const rows = createWebgpuRowState(pages, table)
  rows.pageTableFloats = new Float32Array(table * ROW_WORDS)
  rows.pageTableInts = new Uint32Array(rows.pageTableFloats.buffer)
  pages.forEach((_, page) => {
    rows.residentOffsetWords[page] = page * 16
    rows.touchPage(page)
  })
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
    (ids, visit) => closure.closeOver(ids, visit, undefined, true),
  )
  const packed = packDagSelection(roots)
  /** The view of the placement `back` places behind the one packed last: the strip camera slid
   *  along -x, the packing's worlds brought to its render frame. */
  const view = (back = 0) => {
    const cam = stripCamera(dag)
    cam.world[12] -= back * SPACING
    writeEngineCamera(cam, { fov: 70, aspect: 16 / 9, near: 0.1, far: 4000, zoom: 1 })
    packedWorldsToRenderOrigin(packed, roots, cam.eye)
    return cameraSelectionUniforms(cam, 1, [1280, 720])
  }
  /** The first packed instance of the placement `back` behind the one packed last. */
  const base = (back = 0) => placement.baseOfRoot[roots.length - 1 - back]
  return { rows, sync, packed, view, base, pagesPer: dag.pages.length, instances: pages.length }
}

/** Cuts the view `back` and follows until the drawn cut is the wanted one, `rounds` readbacks at
 *  most, every round on one device and one build of the kernel; returns what it settled on. */
export function settleView(scene: ReturnType<typeof rowCacheScene>, back = 0, rounds = 8) {
  const { rows, sync, packed } = scene
  const uniforms = scene.view(back)
  return runOnDawn(async () => {
    const kernel = await openSelectionKernel()
    sync.syncRows(false)
    let drawn: number[] = [],
      wanted: number[] = []
    for (let round = 0; round < rounds; round++) {
      const resident = rows.residentFlags.slice()
      const reading = await kernel.cut({ name: `round ${round}`, packed, uniforms, resident })
      ;({ drawn, pages: wanted } = reading)
      if (drawn.join() === wanted.join()) break
      sync.followCut({ result: { drawablePageIds: drawn, pageIds: reading.requests } })
      sync.syncRows(false)
    }
    await kernel.close()
    return { drawn, wanted }
  }, undefined)
}
