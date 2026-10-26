import type { PageRec } from '../selection/types.ts'
import { createPageCatalogue, type PageList } from '../selection/catalogue.ts'
import { awaitsPageBytes } from '../rows/page/pageSlots.ts'
import { rowHasGeometry } from '../rows/page/pageRow.ts'
import { rootOfPacked, type PlacementIndex } from '../selection/placements.ts'
import { createSparseInts } from '../cut/sparseInts.ts'
import { noteClass, type PresentClasses } from '../../gpu/core/presentClasses.ts'
import {
  CLUSTER_INFO,
  CLUSTER_INFO_BYTES,
  CLUSTER_INFO_WORDS,
} from '../dag/info/clusterInfoLayout.ts'
import { FLAG_DISPLACED } from '../../visibility/types.ts'
import { UNTESSELLATED } from '../../visibility/tessellation/rowWgsl.ts'
import type { ClusterState } from './clusterState.ts'
import type { createInfoWriter } from './infoWrite.ts'
import { createInfoStage } from './infoStage.ts'

/** Where the cluster records go and which cluster each page's record is: the cut's buffers and
 *  tables, none before the cut exists (`GpuSelection.cutTables`, `GpuSelection.info`). */
export type InfoTarget = {
  device: GPUDevice
  /** The records' buffer (`../dag/info/clusterInfoLayout.ts`): another once the cut is made again. */
  buffer: GPUBuffer
  /** What a packed page's index adds to reach its record, and the packing's placements. */
  infoShift: Uint32Array
  placement: PlacementIndex
  /** The records of the clusters never measured, told to the GPU's measure (`../dag/info/measureWgsl.ts`)
   *  once written. */
  measure(records: Uint32Array, count: number): void
}

/** What the pass keeps per cluster record that is written: a page that names it (plus one), the
 *  slot it was written at (plus one), the epoch of the surfaces it was written at, and its class
 *  (plus one). A record never written reads zero in each. */
interface Records {
  clusters: ClusterState
  recordOf: (page: number) => PageRec | undefined
  write: ReturnType<typeof createInfoWriter>
  classes: PresentClasses
  displacedClasses: PresentClasses
  onResidenceChange: (rec: PageRec, page: number) => void
  pageOf: ReturnType<typeof createSparseInts>
  slotOf: ReturnType<typeof createSparseInts>
  epochOf: ReturnType<typeof createSparseInts>
  classOf: ReturnType<typeof createSparseInts>
  displacedOf: ReturnType<typeof createSparseInts>
  bufferHeld: GPUBuffer | undefined
  epochHeld: number
  stage: ReturnType<typeof createInfoStage> | undefined
  follower: { sync(): void; dirty: boolean }
  cacheReady: () => boolean
  target: () => InfoTarget | undefined
}

const infoOf = (target: InfoTarget, page: number) =>
  (page + target.infoShift[rootOfPacked(target.placement, page)]) >>> 0

/** Record `n` wears the class `key` of a cluster the tessellation takes, or none (-1). */
const noteDisplaced = (r: Records, n: number, key: number) => {
  const before = r.displacedOf.get(n) - 1
  if (before === key) return
  if (before >= 0) noteClass(r.displacedClasses, before, -1)
  if (key >= 0) noteClass(r.displacedClasses, key, 1)
  r.displacedOf.set(n, key + 1)
}

/** Cluster record `n` made current for page `page` in its slot `offset`: written when it is
 *  absent, at another slot or at another epoch of the surfaces. */
const ensure = (r: Records, n: number, page: number, rec: PageRec, offset: number) => {
  const { clusters } = r
  const held = r.slotOf.get(n) - 1
  if (held === offset && r.epochOf.get(n) === clusters.infoEpoch) return
  const written = r.write(rec, offset)
  r.stage!.put(n, written.words)
  const before = r.classOf.get(n) - 1
  if (before !== written.classKey) {
    if (before >= 0) noteClass(r.classes, before, -1)
    noteClass(r.classes, written.classKey, 1)
    r.classOf.set(n, written.classKey + 1)
  }
  const flags = written.words[CLUSTER_INFO.at.flags]
  noteDisplaced(r, n, flags & FLAG_DISPLACED && !(flags & UNTESSELLATED) ? written.classKey : -1)
  clusters.surfaces.set(n, rec.material)
  if (held < 0) r.stage!.measure(n)
  r.pageOf.set(n, page + 1)
  r.slotOf.set(n, offset + 1)
  r.epochOf.set(n, clusters.infoEpoch)
}

/** Cluster record `n` let go: its page left the pool. */
const release = (r: Records, n: number) => {
  if (r.slotOf.get(n) === 0) return
  r.clusters.surfaces.drop(n)
  const klass = r.classOf.get(n) - 1
  if (klass >= 0) noteClass(r.classes, klass, -1)
  noteDisplaced(r, n, -1)
  for (const map of [r.pageOf, r.slotOf, r.epochOf, r.classOf]) map.set(n, 0)
}

/** Residency flag of a page, and the candidate count: a blended cluster draws in the blend pass
 *  and is not counted. Idempotent. */
const setResident = (r: Records, page: number, rec: PageRec, resident: boolean) => {
  const { clusters } = r
  const value = resident ? 1 : 0
  if (clusters.residentFlag(page) === value) return
  clusters.setResidentFlag(page, value)
  clusters.noteResidencyChange(page)
  r.onResidenceChange(rec, page)
  if (!rec.transparent) clusters.candidateCount += resident ? 1 : -1
}

/** The cut was made anew: its packing may rank the records otherwise, and its buffer holds none.
 *  Every record held is let go and every resident page walked, so each cluster in the pool has
 *  its record written in the new buffer. */
const rebuild = (r: Records, target: InfoTarget) => {
  const { clusters } = r
  const held: number[] = []
  r.classOf.forEach((n) => void held.push(n))
  for (const n of held) noteClass(r.classes, r.classOf.get(n) - 1, -1)
  const shown: number[] = []
  r.displacedOf.forEach((n) => void shown.push(n))
  for (const n of shown) noteDisplaced(r, n, -1)
  for (const map of [r.pageOf, r.slotOf, r.epochOf, r.classOf]) map.clear()
  clusters.surfaces.clear()
  const { pages, count } = clusters.residentPages()
  for (let i = 0; i < count; i++) {
    const page = pages[i],
      rec = r.recordOf(page)
    if (!rec || rec.transparent || !rowHasGeometry(rec)) continue
    const offset = clusters.offsetOf(page)
    if (offset >= 0 && !awaitsPageBytes(rec)) ensure(r, infoOf(target, page), page, rec, offset)
  }
}

/** Every record written again: the surfaces moved on. */
const rewriteAll = (r: Records) => {
  const records: number[] = []
  r.pageOf.forEach((n) => void records.push(n))
  for (const n of records) {
    const page = r.pageOf.get(n) - 1,
      rec = r.recordOf(page)
    const offset = rec ? r.clusters.offsetOf(page) : -1
    if (rec && offset >= 0) ensure(r, n, page, rec, offset)
  }
}

/** The pages the cache named, in the order of the journal (`touched`). */
const followTouched = (r: Records, target: InfoTarget) => {
  const { clusters } = r
  const { touched } = clusters
  for (let i = 0; i < touched.count; i++) {
    const page = touched.pages[i],
      rec = r.recordOf(page)
    if (!rec) continue
    const offset = clusters.offsetOf(page),
      inSlot = offset >= 0 && !awaitsPageBytes(rec)
    // An opaque cluster draws from its record; a blended one from its slot itself
    // (`../../blend/transparent/spans.ts`).
    if (!rec.transparent && rowHasGeometry(rec)) {
      const n = infoOf(target, page)
      if (inSlot) ensure(r, n, page, rec, offset)
      else release(r, n)
    }
    const wasResident = clusters.residentFlag(page) === 1
    setResident(r, page, rec, inSlot)
    // A page that keeps its flag but moved in its slot is still announced: the image reads it.
    if (inSlot && wasResident) r.onResidenceChange(rec, page)
  }
}

/** What the cache moved and the surfaces' epoch ask of the records, written where the cut
 *  reads them; false when there is nothing to do, or no cut to write to. */
const syncRecords = (r: Records) => {
  const { clusters, follower } = r
  if (!r.cacheReady()) return false
  const target = r.target()
  if (!target) return false
  clusters.clearResidencyChanges()
  follower.sync()
  const rebuilt = target.buffer !== r.bufferHeld
  if (!follower.dirty && !clusters.touched.count && !rebuilt && r.epochHeld === clusters.infoEpoch)
    return false
  follower.dirty = false
  if (rebuilt) {
    r.bufferHeld = target.buffer
    r.stage = createInfoStage(target.device, target.buffer, CLUSTER_INFO_BYTES, CLUSTER_INFO_WORDS)
    rebuild(r, target)
  }
  followTouched(r, target)
  if (!rebuilt && r.epochHeld !== clusters.infoEpoch) rewriteAll(r)
  r.epochHeld = clusters.infoEpoch
  r.stage!.flush(target.measure)
  clusters.clearTouched()
  return true
}

/** Bytes of the pass's own tables, a few words for each record written. */
const recordBytes = (r: Records) =>
  r.pageOf.byteLength +
  r.slotOf.byteLength +
  r.epochOf.byteLength +
  r.classOf.byteLength +
  r.displacedOf.byteLength +
  r.clusters.surfaces.hostBytes

/**
 * THE RESIDENCY OF THE CLUSTERS THE CUT DRAWS. A packed page is resident for the cut once its bytes
 * are in their pool slot (`offsetOf`, `awaitsPageBytes`) and, for an opaque cluster, its cluster
 * record — the words every placement of it shares: its slot, its geometry, its surface — is written
 * where the GPU reads it (`../dag/info/clusterInfoLayout.ts`). The record is written in the pass
 * that flags the page, so the cut that reads the flag reads the record: no cluster waits for a
 * row, none is claimed from a table, none is a late page.
 *
 * What the pass reads is the journal of the pages the cache named since its last pass
 * (`./journal.ts`): a page that arrived, left or moved. A record is made once for the placements
 * that share it (a page array's cluster, `PackedDag.infoShift`), written again when its slot moves
 * or when the surfaces' epoch moved (`ClusterState.infoEpoch`), and let go with the page that
 * held it. Written in runs, one `writeBuffer` for every record that touches the next
 * (`./infoStage.ts`). A cut made again (another buffer) has every record of the pool written anew.
 * The classes the records wear are counted for the material pass (`PresentClasses`), and apart the
 * classes of those the tessellation takes — displaced, and none a line, a sprite or a voxel brick
 * (`UNTESSELLATED`) —, which shade through the displaced pipelines (`../../visibility/tessellation/prismFrame.ts`).
 */
export function createClusterResidency(options: {
  clusters: ClusterState
  packedPages: PageList
  follower: { sync(): void; dirty: boolean }
  cacheReady: () => boolean
  target: () => InfoTarget | undefined
  write: ReturnType<typeof createInfoWriter>
  classes: PresentClasses
  displacedClasses: PresentClasses
  /** Called when a page enters residency, leaves it or moves in its slot. */
  onResidenceChange: (rec: PageRec, page: number) => void
}) {
  const { clusters } = options
  const r: Records = {
    ...options,
    recordOf: createPageCatalogue(options.packedPages).recordOf,
    pageOf: createSparseInts(),
    slotOf: createSparseInts(),
    epochOf: createSparseInts(),
    classOf: createSparseInts(),
    displacedOf: createSparseInts(),
    bufferHeld: undefined,
    epochHeld: 0,
    stage: undefined,
  }
  return {
    sync: () => syncRecords(r),
    /** Whether the pass is owed: the cache moved a page, or the surfaces' epoch did. */
    get owed() {
      return clusters.touched.count > 0 || r.epochHeld !== clusters.infoEpoch
    },
    get bytes() {
      return recordBytes(r)
    },
  }
}
