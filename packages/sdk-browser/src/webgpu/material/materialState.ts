import type { Span } from '../../../../math/src/sequence/span.ts'
import type { PageSurface } from '../../page/surface.ts'
import type { MaterialSurface } from './materialRecord.ts'

/**
 * A surface's place in the table: its record's rank, its lobe extension's index (−1: none), the
 * version and atlas epoch it was last written at, and what its rows and items read of it beside
 * its record (`materialSummary.ts`) — their flags' surface bits, their resolve class's, and the
 * facts a frame derives from its rows' surfaces —, which an edit compares to tell whether a row
 * must be written again.
 */
export type MaterialEntry = {
  rank: number
  lobes: number
  version: number | undefined
  epoch: number
  flags: number
  classKey: number
  facts: number
}

/** What the table holds (`materialTable.ts`). */
export type MaterialRecords = {
  /** Each surface's place, by its record, and each rank's surface, held weakly: what an atlas
   *  census walks (`forget`). */
  entries: WeakMap<object, MaterialEntry>
  surfaces: (WeakRef<MaterialSurface> | undefined)[]
  /** Ranks and lobe extensions whose surface the collector took or which lost its lobes, handed
   *  out again before a new one. */
  freed: number[]
  lobesFreed: number[]
  /** The record places that hold the lobe extensions, three each, and the extensions handed out. */
  lobeSlots: number[]
  lobesHeld: number
  reclaim: FinalizationRegistry<MaterialEntry>
  ints: Uint32Array<ArrayBuffer>
  /** Ranks handed out so far (the table's height), the atlas slots' epoch, and the range of
   *  records written since the last upload (`from > to`: none). */
  held: number
  epoch: number
  written: Span
  texture: GPUTexture | undefined
  /** A surface rewritten since the last `follow` changed what its rows or items read beside its
   *  record; the atlas's slots moved since; the surfaces written since (`surfaceJournals`). */
  moved: boolean
  forgotten: boolean
  journal: Set<PageSurface> | undefined
}
