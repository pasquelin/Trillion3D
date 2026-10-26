import { createCutReadiness, type CutReadiness } from '../../geometry/cut/readiness.ts'
import { rootOfPacked } from '../../geometry/selection/placements.ts'
import type { CutTables } from '../../geometry/dag/cut/cutReaders.ts'
import { FLAG_CLUSTER_PAGE } from '../../visibility/types.ts'
import { rowIndexCount } from '../../geometry/rows/page/pageRow.ts'
import { emptyGeometryBlock, rowGeometry } from '../../geometry/rows/page/pageRowMaterial.ts'
import type { WebgpuPagesCore } from '../../frame/backend/runtime.ts'
import { createChangedRuns } from '../../geometry/residency/ranges.ts'

/** Words of a record of the table: its pool slot plus one (zero out of the pool), its flags, the
 *  first vertex of its float geometry, and its corners. */
export const RECORD_WORDS = 4
/** A record's flags beside `FLAG_CLUSTER_PAGE`: a ray tests it — the finest the pool holds of its
 *  surface —; it has no area a ray meets — a sprite —; its quads are line segments, met where the
 *  ray passes within its reach of one (`rayPageWgsl.ts`). */
export const RECORD_DRAWABLE = 1,
  RECORD_NO_AREA = 2,
  RECORD_LINE = 4

/** One primitive's records: their first, its pages' records, the readiness the pool decides, and
 *  which of its clusters a finer group produced (`ClusterStructureIndex.sources`). */
type Primitive = {
  base: number
  first: number
  count: number
  readiness: CutReadiness
  sources: Int32Array | undefined
}

/** What the table of records holds between calls. */
interface RecordTable {
  readonly prims: Map<number, Primitive>
  readonly block: ReturnType<typeof emptyGeometryBlock>
  readonly dirty: ReturnType<typeof createChangedRuns>
  words: Uint32Array<ArrayBuffer>
  tables: CutTables | undefined
  /** What the table was built over beside the links: its records and the packing's pages. */
  recordCount: number
  packedCount: number
}

/** Record `first + p`'s words from page `page`, its `p`th, of a primitive. */
function writeRecord(rt: WebgpuPagesCore, t: RecordTable, prim: Primitive, p: number) {
  const { words } = t
  const page = prim.first + p,
    rec = rt.layout.recordOf(page),
    r = (prim.base + p) >>> 0,
    at = r * RECORD_WORDS
  if (!rec || at + RECORD_WORDS > words.length) return
  const geo = rowGeometry(rec, rt.vis.geometryBlocks, t.block),
    slot = rt.layout.clusters.offsetOf(page),
    // The cut rule at a zero threshold: a cluster of the finest level stands for itself, a coarser
    // one only while the finer group replacing it is not ready.
    finest = !prim.sources || prim.sources[p] < 0,
    ready = prim.readiness.isReady(p) && (finest || !prim.readiness.isChildReady(p))
  words[at] = geo && slot >= 0 ? slot + 1 : 0
  // A voxel page draws its bricks' boxes, no triangle of the surface: a ray takes the finer
  // clusters it stands for, never it — a far-field drawing, not a surface to hit.
  words[at + 1] =
    (geo?.quantized ? FLAG_CLUSTER_PAGE : 0) |
    (geo && slot >= 0 && ready && !geo.voxel ? RECORD_DRAWABLE : 0) |
    (rec.material.sprite ? RECORD_NO_AREA : 0) |
    ((rec.material.lineWidth ?? 0) > 0 ? RECORD_LINE : 0)
  words[at + 2] = geo?.vertexBase ?? 0
  words[at + 3] = rowIndexCount(rec)
  t.dirty.mark(r)
}

/** Page `p` of `prim` in or out of the pool as the cache holds it, and the records whose
 *  readiness that moved. */
function followPage(rt: WebgpuPagesCore, t: RecordTable, prim: Primitive, p: number) {
  prim.readiness.set(p, rt.layout.clusters.offsetOf(prim.first + p) >= 0)
  prim.readiness.settle((q) => writeRecord(rt, t, prim, q))
  writeRecord(rt, t, prim, p)
}

/** Every record, from the pool as it stands: at the first read, and once the packing moved. */
function buildTable(rt: WebgpuPagesCore, t: RecordTable, next: CutTables) {
  t.tables = next
  t.prims.clear()
  t.dirty.clear()
  t.words = new Uint32Array(Math.max(1, next.recordCount) * RECORD_WORDS)
  next.cutLinks.forEach((links, w) => {
    const base = (links.pageBase + next.recordShift[w]) >>> 0
    if (t.prims.has(base) || !links.pageCount) return
    const readiness = createCutReadiness(links.structure, undefined)
    const prim = {
      base,
      first: links.pageBase,
      count: links.pageCount,
      readiness,
      sources: links.structure?.sources,
    }
    t.prims.set(base, prim)
    for (let p = 0; p < prim.count; p++)
      readiness.set(p, rt.layout.clusters.offsetOf(prim.first + p) >= 0)
    readiness.settle()
    for (let p = 0; p < prim.count; p++) writeRecord(rt, t, prim, p)
  })
}

/**
 * WHAT A RAY DECODES OF EACH CLUSTER, WHEREVER IT IS DRAWN OR NOT: one record a unique cluster of
 * the packing (`../../geometry/dag/layout.ts`, `recordOf`, shared by every placement of its primitive) —
 * where its geometry lies in the pool, how to decode it (`rowGeometry`, `rowIndexCount`, the
 * rasters' own words for a row), and whether a ray tests it. A ray tests the finest representation
 * the POOL holds: the cut rule at no threshold (`../../geometry/cut/rule.ts`) over the readiness of the
 * engine's one derivation (`createCutReadiness`), fed by the pool's residency — never by the
 * clusters this frame's views draw, so a page out of every view is met as one in it. A record's slot is
 * read where it is true, on the cache (`../../geometry/clusters/pageState.ts`, `offsetOf`), never kept on the host:
 * the residency log names the pages whose slot moved (`moved`), each record written again from the
 * cache, and the words go up in runs (`rayQuery.ts`).
 */
export function createRayRecords(rt: WebgpuPagesCore) {
  const t: RecordTable = {
    prims: new Map(),
    block: emptyGeometryBlock(),
    dirty: createChangedRuns(),
    words: new Uint32Array(0),
    tables: undefined,
    recordCount: -1,
    packedCount: -1,
  }
  return {
    /** The table over `next`, built again when the packing or its pages were laid anew. True when it
     *  was: every word goes up. */
    sync(next: CutTables) {
      const { packedPages } = rt.layout
      if (
        next.cutLinks === t.tables?.cutLinks &&
        next.recordCount === t.recordCount &&
        packedPages.length === t.packedCount
      )
        return false
      t.recordCount = next.recordCount
      t.packedCount = packedPages.length
      buildTable(rt, t, next)
      return true
    },
    /** Packed page `page` — its primitive page's least rank — took a slot, moved or left the pool,
     *  as the residency log names it once per primitive (`../../geometry/residency/residencyFollow.ts`): its record,
     *  shared by every placement, reads the slot again on the cache. */
    moved(page: number) {
      const { tables } = t
      if (!tables) return
      const w = rootOfPacked(rt.layout.placement, page),
        links = tables.cutLinks[w]
      const prim = links && t.prims.get((links.pageBase + tables.recordShift[w]) >>> 0)
      if (prim) followPage(rt, t, prim, page - links.pageBase)
    },
    /** The words. */
    get words() {
      return t.words
    },
    /** The records written since the last call, increasing: a view the next call overwrites. */
    takeDirty: () => t.dirty.take(),
  }
}
export type RayRecords = ReturnType<typeof createRayRecords>
