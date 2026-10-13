import { createCutReadiness, type CutReadiness } from '../../page/cut/readiness.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import { rootOfPacked } from '../../page/selection/placements.ts'
import { refreshSurface } from '../../page/surface.ts'
import type { CutTables } from '../../gpu/core/selection.ts'
import { FLAG_CLUSTER_PAGE } from '../../visibility/types.ts'
import { pageAddress } from '../row/pageSlots.ts'
import { rowIndexCount } from '../row/pageRow.ts'
import { emptyGeometryBlock, rowGeometry } from '../row/pageRowMaterial.ts'
import type { WebgpuPagesCore } from '../pages/runtime.ts'

/** Words of a record of the table: its pool slot plus one (zero out of the pool), its flags, the
 *  first vertex of its float geometry, and its corners. */
export const RECORD_WORDS = 4
/** A record's flags beside `FLAG_CLUSTER_PAGE`: a ray tests it — the finest the pool holds of its
 *  surface —; it has no area — a line, a point, a sprite —, never met. */
export const RECORD_DRAWABLE = 1,
  RECORD_NO_AREA = 2

/** One primitive's records: their first, its pages' records, the readiness the pool decides, and
 *  which of its clusters a finer group produced (`ClusterStructureIndex.sources`). */
type Primitive = {
  base: number
  first: number
  count: number
  readiness: CutReadiness
  sources: Int32Array | undefined
}

/**
 * WHAT A RAY DECODES OF EACH CLUSTER, WHEREVER IT IS DRAWN OR NOT: one record a unique cluster of
 * the packing (`../../gpu/dag/layout.ts`, `recordOf`, shared by every placement of its primitive) —
 * where its geometry lies in the pool, how to decode it (`rowGeometry`, `rowIndexCount`, the
 * rasters' own words for a row), and whether a ray tests it. A ray tests the finest representation
 * the POOL holds: the cut rule at no threshold (`../../page/cut/rule.ts`) over the readiness of the
 * engine's one derivation (`createCutReadiness`), fed by the pool's residency — never by the rows
 * this frame's views hold, so a page out of every view is met as one in it. The pool's moves reach
 * it page by page (`moved`, the residency mirror's), each written into its record; the words go up
 * in runs (`upload`).
 */
export function createRayRecords(rt: WebgpuPagesCore) {
  const prims = new Map<number, Primitive>(),
    block = emptyGeometryBlock(),
    dirty = new Set<number>()
  let words = new Uint32Array(0),
    tables: CutTables | undefined,
    signature = ''
  /** Record `first + p`'s words from page `page`, its `p`th, of a primitive. */
  const write = (prim: Primitive, p: number) => {
    const page = prim.first + p,
      rec = rt.layout.recordOf(page),
      r = (prim.base + p) >>> 0,
      at = r * RECORD_WORDS
    if (!rec || at + RECORD_WORDS > words.length) return
    const geo = rowGeometry(rec, rt.vis.geometryBlocks, block),
      slot = rt.layout.rows.addressOffset(pageAddress(rec)),
      // The cut rule at a zero threshold: a cluster of the finest level stands for itself, a coarser
      // one only while the finer group replacing it is not ready.
      finest = !prim.sources || prim.sources[p] < 0,
      ready = prim.readiness.isReady(p) && (finest || !prim.readiness.isChildReady(p))
    words[at] = geo && slot >= 0 ? slot + 1 : 0
    words[at + 1] =
      (geo?.quantized ? FLAG_CLUSTER_PAGE : 0) |
      (geo && slot >= 0 && ready ? RECORD_DRAWABLE : 0) |
      (noArea(rec) ? RECORD_NO_AREA : 0)
    words[at + 2] = geo?.vertexBase ?? 0
    words[at + 3] = rowIndexCount(rec)
    dirty.add(r)
  }
  /** Page `p` of `prim` in or out of the pool, and the records whose readiness that moved. */
  const follow = (prim: Primitive, p: number, held: boolean) => {
    prim.readiness.set(p, held)
    prim.readiness.settle((q) => write(prim, q))
    write(prim, p)
  }
  /** Every record, from the pool as it stands: at the first read, and once the packing moved. */
  const build = (next: CutTables) => {
    tables = next
    prims.clear()
    dirty.clear()
    words = new Uint32Array(Math.max(1, next.recordCount) * RECORD_WORDS)
    next.cutLinks.forEach((links, w) => {
      const base = (links.pageBase + next.recordShift[w]) >>> 0
      if (prims.has(base) || !links.pageCount) return
      const readiness = createCutReadiness(links.structure, undefined)
      const prim = {
        ...{ base, first: links.pageBase, count: links.pageCount, readiness },
        sources: links.structure?.sources,
      }
      prims.set(base, prim)
      for (let p = 0; p < prim.count; p++) {
        const rec = rt.layout.recordOf(prim.first + p)
        if (rec) readiness.set(p, rt.layout.rows.addressOffset(pageAddress(rec)) >= 0)
      }
      readiness.settle()
      for (let p = 0; p < prim.count; p++) write(prim, p)
    })
  }
  return {
    /** The table over `next`, built again when the packing, its pages or its rows were laid anew.
     *  True when it was: every word goes up. */
    sync(next: CutTables) {
      const { rows, packedPages } = rt.layout
      const now = `${next.recordCount} ${packedPages.length} ${rows.rowsRevision}`
      if (next.cutLinks === tables?.cutLinks && now === signature) return false
      signature = now
      build(next)
      return true
    },
    /** Packed page `page`'s address took slot `slotWords`, or left the pool (`< 0`). */
    moved(page: number, slotWords: number) {
      if (!tables) return
      const w = rootOfPacked(rt.layout.placement, page),
        links = tables.cutLinks[w]
      const prim = links && prims.get((links.pageBase + tables.recordShift[w]) >>> 0)
      if (prim) follow(prim, page - links.pageBase, slotWords >= 0)
    },
    /** The words, and the records written since the last call, in increasing runs. */
    get words() {
      return words
    },
    takeDirty() {
      const runs = [...dirty].sort((a, b) => a - b)
      dirty.clear()
      return runs
    },
  }
}
export type RayRecords = ReturnType<typeof createRayRecords>

/** Whether a record's surface has no area a ray meets: a line, a point, a sprite. */
const noArea = (rec: PageRec) => {
  const mat = refreshSurface(rec.material)
  return (mat.lineWidth ?? 0) > 0 || !!mat.sprite
}
