import type { RecordTexture } from '../../gpu/core/recordTexture.ts'
import { createChangedRuns } from '../residency/ranges.ts'
import type { PageSurface } from '../../page/surface.ts'
import type { MaterialSurface } from './materialRecord.ts'
import { MATERIAL_RECORD_WORDS } from './materialLayout.ts'
import { emptySurfaceRow } from '../row/surfaceRow.ts'

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
 * What the table last saw of a surface, first seen at rank `rank`: the version and atlas epoch it
 * wrote its record at, its record's rank, and what its rows and items read of it beside the record
 * (`materialSummary.ts`) — what it brings to each row (`row`, `../row/surfaceRow.ts`), their flags'
 * surface bits, their resolve class's, and the facts a frame derives from its rows' surfaces —,
 * which an edit compares to tell whether a row must be written again, and a row write reads instead
 * of its surface's maps.
 */
export const surfaceSeen = (rank: number) => ({
  version: undefined as number | undefined,
  epoch: -1,
  rank,
  row: emptySurfaceRow(),
  flags: 0,
  classKey: 0,
  facts: 0,
})
export type SurfaceSeen = ReturnType<typeof surfaceSeen>

/** What the table holds (`materialTable.ts`), empty; `release` frees an entry whose surface the
 *  collector took. */
export function createMaterialRecords(release: (entry: MaterialEntry) => void) {
  return {
    /** Each record's place, by its material's own surface (`variantPlain`), what the table last
     *  saw of each surface, and each rank's material, held weakly: what an atlas census walks
     *  (`forget`). */
    entries: new WeakMap<object, MaterialEntry>(),
    seen: new WeakMap<object, SurfaceSeen>(),
    surfaces: [] as (WeakRef<object> | undefined)[],
    /** Ranks and lobe extensions whose surface the collector took or which lost its lobes, handed
     *  out again before a new one. */
    freed: [] as number[],
    lobesFreed: [] as number[],
    /** The record places that hold the lobe extensions, three each, and the extensions handed
     *  out. */
    lobeSlots: [] as number[],
    lobesHeld: 0,
    reclaim: new FinalizationRegistry<MaterialEntry>(release),
    /** The records as the host last wrote them: what a write compares to tell a change, and the
     *  span an upload sends; never sent again when the texture grows. */
    ints: new Uint32Array(MATERIAL_RECORD_WORDS),
    /** Ranks handed out so far (the table's height), the atlas slots' epoch, and the records
     *  written since the last upload, each once (`createChangedRuns`). */
    held: 0,
    epoch: 0,
    written: createChangedRuns(),
    /** The table's record texture, made at the first upload. */
    records: undefined as RecordTexture | undefined,
    /** A surface rewritten since the last `follow` changed what its rows or items read beside its
     *  record; the atlas's slots moved since; the surfaces written since (`surfaceJournals`). */
    moved: false,
    forgotten: false,
    journal: undefined as Set<PageSurface> | undefined,
  }
}
export type MaterialRecords = ReturnType<typeof createMaterialRecords>
