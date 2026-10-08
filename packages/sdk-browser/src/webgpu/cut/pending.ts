import type { PageRec } from '../../page/selection/selection.ts'
import type { IdDelta } from './delta.ts'
import { createDenseKeySet } from './denseKeys.ts'
import { createSparseInts } from '../../page/cut/sparseInts.ts'
import { awaitsClosure, awaitsPageBytes } from '../row/pageSlots.ts'
import { createPageCatalogue, type PageList } from '../pages/prepare/catalogue.ts'

/**
 * Pages of the requested cut that do not yet have their bytes, held from one image to the next.
 *
 * Two readers live off it: the held image, which refuses to hold while an awaited page can still
 * change the cut, and the list of addresses the host must go fetch. Walking the whole cut for them
 * would re-read fifteen thousand records per image to answer, almost always, "none".
 *
 * The set only moves here of what moves: the pages the cut difference names, and those whose
 * bytes just arrived or left — which the rank journal already names. `records` is the list of
 * missing records the pool accepted, and only the missing ones are walked: the rule that turns
 * them into addresses is everyone's (`collectPendingUrls`), not a copy. Membership in the cut is
 * that of the difference, to which this set is attached once and for all.
 */
export function createCutPending(
  packedPages: PageList,
  delta: IdDelta,
  accepted: (rec: PageRec) => boolean = () => true,
  /** Changes whenever `accepted` may answer differently: the awaited list is rebuilt then only. */
  acceptedRevision: () => number = () => 0,
  /** The first packed rank of a record: one record serves many placements (#1235). */
  rankOf: (rec: PageRec) => number = () => -1,
) {
  /** A packed rank back to its record: the one catalogue accessor (`../pages/prepare/catalogue.ts`). */
  const { recordOf } = createPageCatalogue(packedPages)
  const records: PageRec[] = []
  const s: PendingState = {
    ...{ delta, accepted, acceptedRevision, rankOf, recordOf, records },
    missing: createDenseKeySet(records),
    awaited: [],
    dependents: createDenseKeySet(),
    named: createSparseInts(),
    ...{ settle: false, rescan: false, stale: true, revision: 0 },
  }
  return {
    /** Records the pool accepted that still await their bytes or those of their closure, and their
     *  count: the held image only reads that count. */
    get records() {
      reconcile(s)
      return s.awaited
    },
    get count() {
      reconcile(s)
      return s.awaited.length
    },
    /** Bytes of the sets above, all sized by the cut. */
    get hostBytes() {
      return s.missing.byteLength + s.dependents.byteLength + s.named.byteLength
    },
    /** The difference that has just been applied: exits first, entries next. */
    apply: () => applyDelta(s),
    /** A page's bytes have just arrived or left. */
    touch: (id: number) => touchPage(s, id),
  }
}

type PendingState = {
  delta: IdDelta
  accepted: (rec: PageRec) => boolean
  acceptedRevision: () => number
  rankOf: (rec: PageRec) => number
  recordOf: ReturnType<typeof createPageCatalogue>['recordOf']
  /** Records of the missing pages, held at their key rank by the set itself. */
  records: PageRec[]
  missing: ReturnType<typeof createDenseKeySet>
  /** The missing records the pool accepted: the only ones an image waits for and the host fetches.
   *  A page past the page budget never gets a slot, so waiting for it would never settle. */
  awaited: PageRec[]
  /** Cut records that name a closure (`PageRec.dependencies`), and how many of them name each
   *  record: that record's bytes arriving or leaving moves cut records the journal does not name.
   *  Both follow the cut, never the catalogue. */
  dependents: ReturnType<typeof createDenseKeySet>
  named: ReturnType<typeof createSparseInts>
  /** A dependency arrived (`settle`: drop the members now complete) or left (`rescan`: the cut's
   *  dependents are re-read). Both are done once, when the set is next read. */
  settle: boolean
  rescan: boolean
  /** The awaited list no longer matches `missing` or `accepted`. */
  stale: boolean
  revision: number
}

function name(s: PendingState, id: number, step: number) {
  const dependencies = s.recordOf(id)?.dependencies
  if (!dependencies?.length) return
  if (step > 0) s.dependents.add(id)
  else s.dependents.remove(id)
  for (const dependency of dependencies) {
    const rank = s.rankOf(dependency)
    if (rank >= 0) s.named.add(rank, step)
  }
}

function reconcile(s: PendingState) {
  const { missing, records, dependents } = s
  if (s.rescan)
    for (let i = 0; i < dependents.count; i++) {
      const id = dependents.list[i],
        rec = s.recordOf(id)
      if (rec && awaitsClosure(rec) && missing.add(id, rec)) s.stale = true
    }
  if (s.settle || s.rescan)
    for (let i = missing.count - 1; i >= 0; i--)
      if (!awaitsClosure(records[i]) && missing.remove(missing.list[i])) s.stale = true
  s.settle = s.rescan = false
  const now = s.acceptedRevision()
  if (!s.stale && now === s.revision) return
  s.stale = false
  s.revision = now
  s.awaited.length = 0
  for (let i = 0; i < missing.count; i++) if (s.accepted(records[i])) s.awaited.push(records[i])
}

function applyDelta(s: PendingState) {
  const { delta, missing } = s,
    exits = delta.exited,
    entries = delta.entered
  for (let i = 0; i < delta.exitedCount; i++) {
    const id = exits[i]
    name(s, id, -1)
    if (missing.remove(id)) s.stale = true
  }
  for (let i = 0; i < delta.enteredCount; i++) {
    const id = entries[i]
    const rec = s.recordOf(id)
    name(s, id, 1)
    if (rec && awaitsClosure(rec) && missing.add(id, rec)) s.stale = true
  }
}

function touchPage(s: PendingState, id: number) {
  const rec = s.recordOf(id)
  if (!rec) return
  const rank = s.rankOf(rec)
  if (rank >= 0 && s.named.get(rank) > 0) {
    if (awaitsPageBytes(rec)) s.rescan = true
    else s.settle = true
  }
  if (!s.delta.has(id)) return
  if (awaitsClosure(rec) ? s.missing.add(id, rec) : s.missing.remove(id)) s.stale = true
}
