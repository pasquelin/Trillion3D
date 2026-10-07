// The row cache's bench (#1483): `instances` opaque clusters, each at its own address, over a table
// of `slots` visibility rows, the residency mirror and the readbacks driven by hand.
import { createWebgpuRowState } from './state.ts'
import { createWebgpuRowSync } from './sync.ts'
import type { CloseInstances } from './rowDemand.ts'
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import { DAG_READBACK_SLOTS } from '../../gpu/dag/layout.ts'

const WORDS = PAGE_INFO_STRIDE / 4

/** The idle span the row use is held to (`rowUse.ts`): readbacks a row stays unused before a
 *  request may take it back, four times the slots in flight and the image being encoded. */
export const ROW_IDLE_READBACKS = 4 * (DAG_READBACK_SLOTS + 1)

/** A mirror with nothing to report: the fixtures move residency by hand. */
export const MIRROR = { sync: () => {}, dirty: true }
/** Without group links, an instance closes over itself alone. */
export const closeAlone: CloseInstances = (ids, visit) => {
  for (let i = 0; i < ids.length; i++) visit(ids[i])
}

export function rowCache(instances: number, slots: number) {
  const pages = Array.from(
    { length: instances },
    (_, id) =>
      ({
        id,
        url: `p/${id}`,
        array: Uint32Array.of(0, 1, 2),
        attributes: { position: {} },
        transparent: false,
        depthLayer: 0,
      }) as unknown as PageRec,
  )
  const rows = createWebgpuRowState(pages, slots)
  rows.pageTableFloats = new Float32Array(slots * WORDS)
  rows.pageTableInts = new Uint32Array(rows.pageTableFloats.buffer)
  // A row names its instance, one past it, where the GPU would read the record.
  const writer = (
    _rec: PageRec,
    page: number,
    row: number,
    _offset: number,
    _floats: Float32Array,
    ints: Uint32Array,
  ) => void (ints[row * WORDS] = page + 1)
  const sync = createWebgpuRowSync(rows, MIRROR, pages, () => true, writer, closeAlone)
  /** The instances `ids` take their bytes (`offset` a slot) or give them back (-1). */
  const land = (ids: Iterable<number>, offset = 16) => {
    for (const page of ids) {
      rows.residentOffsetWords[page] = offset < 0 ? -1 : page * offset
      rows.touchPage(page)
    }
  }
  /** One readback adopted: what its cut drew, and what it asks for in its order. */
  const readback = (drawn: number[], asked: number[]) =>
    sync.followCut({ result: { drawablePageIds: drawn, pageIds: asked } })
  /** One image's sync, its time budget lifted. */
  const frame = () => sync.syncRows(false)
  /** The instances holding a row, ascending. */
  const held = () =>
    Array.from(rows.packedPageIndex.subarray(0, rows.packedCount)).sort((a, b) => a - b)
  return { rows, sync, land, readback, frame, held }
}

/** `0, 1, …, count - 1`. */
export const range = (count: number, from = 0) => Array.from({ length: count }, (_, i) => from + i)
