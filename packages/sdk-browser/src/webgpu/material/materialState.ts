import type { RecordTexture } from '../../gpu/core/recordTexture.ts'
import type { Span } from '../../../../math/src/sequence/span.ts'
import type { PageSurface } from '../../page/surface.ts'
import type { MaterialSurface } from './materialRecord.ts'
import type { SurfaceRow } from '../row/surfaceRow.ts'

/**
 * A record's place in the table: its rank, its lobe extension's index (−1: none), the atlas epoch
 * it was last written at, and the surface it was last written from — a material's own record
 * (`variantPlain`) or one of its variants', whose values are the same.
 */
export type MaterialEntry = {
  rank: number
  lobes: number
  epoch: number
  source: WeakRef<MaterialSurface> | undefined
}

/**
 * What the table last saw of a surface: the version and atlas epoch it wrote its record at, its
 * record's rank, and what its rows and items read of it beside the record (`materialSummary.ts`) —
 * what it brings to each row (`row`, `../row/surfaceRow.ts`), their flags' surface bits, their
 * resolve class's, and the facts a frame derives from its rows' surfaces —, which an edit compares
 * to tell whether a row must be written again, and a row write reads instead of its surface's maps.
 */
export type SurfaceSeen = {
  version: number | undefined
  epoch: number
  rank: number
  row: SurfaceRow
  flags: number
  classKey: number
  facts: number
}

/** What the table holds (`materialTable.ts`). */
export type MaterialRecords = {
  /** Each record's place, by its material's own surface (`variantPlain`), what the table last saw
   *  of each surface, and each rank's material, held weakly: what an atlas census walks
   *  (`forget`). */
  entries: WeakMap<object, MaterialEntry>
  seen: WeakMap<object, SurfaceSeen>
  surfaces: (WeakRef<object> | undefined)[]
  /** Ranks and lobe extensions whose surface the collector took or which lost its lobes, handed
   *  out again before a new one. */
  freed: number[]
  lobesFreed: number[]
  /** The record places that hold the lobe extensions, three each, and the extensions handed out. */
  lobeSlots: number[]
  lobesHeld: number
  reclaim: FinalizationRegistry<MaterialEntry>
  /** The records as the host last wrote them: what a write compares to tell a change, and the
   *  span an upload sends; never sent again when the texture grows. */
  ints: Uint32Array<ArrayBuffer>
  /** Ranks handed out so far (the table's height), the atlas slots' epoch, and the range of
   *  records written since the last upload (`from > to`: none). */
  held: number
  epoch: number
  written: Span
  /** The table's record texture, made at the first upload. */
  records: RecordTexture | undefined
  /** A surface rewritten since the last `follow` changed what its rows or items read beside its
   *  record; the atlas's slots moved since; the surfaces written since (`surfaceJournals`). */
  moved: boolean
  forgotten: boolean
  journal: Set<PageSurface> | undefined
}
