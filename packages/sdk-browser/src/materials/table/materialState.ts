import type { RecordTexture } from '../../gpu/core/recordTexture.ts'
import { createChangedRuns } from '../../geometry/residency/ranges.ts'
import type { PageSurface } from '../../geometry/pages/surface.ts'
import type { MaterialSurface } from './materialRecord.ts'
import { MATERIAL_RECORD_WORDS } from './materialLayout.ts'
import { emptySurfaceRow } from '../../geometry/rows/surfaceRow.ts'
import { createDisplacementRecords } from './displacementRecord.ts'
import type { GraphBlock } from './graphRecord.ts'

/**
 * A record's place in the table: its rank, its lobe extension's index (−1: none), the atlas epoch
 * it was last written at, and the surface it was last written from — a material's own record
 * (`variantPlain`) or one of its variants', whose values are the same.
 */
export type MaterialEntry = {
  rank: number
  lobes: number
  /** The record places holding the values of its graph, none without one (`graphRecord.ts`). */
  graph: GraphBlock | undefined
  epoch: number
  source: WeakRef<MaterialSurface> | undefined
}

/**
 * What the table last saw of a surface, first seen at rank `rank`: the version and atlas epoch it
 * wrote its record at, its record's rank, and what its rows and items read of it beside the record
 * (`materialSummary.ts`) — what it brings to each row (`row`, `../../geometry/rows/surfaceRow.ts`), their flags'
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
    /** The blocks of record places a graph's values filled, given back, taken again by the first
     *  graph that fits (`graphRecord.ts`). */
    graphFree: [] as GraphBlock[],
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
    /** The displaced surfaces' records, by rank, beside the table's own (`displacementRecord.ts`). */
    displaced: createDisplacementRecords(),
    /** The table's record texture, made at the first upload. */
    records: undefined as RecordTexture | undefined,
    /** A surface rewritten since the last `follow` changed what its rows or items read beside its
     *  record; the atlas's slots moved since; the surfaces written since (`surfaceJournals`). */
    moved: false,
    forgotten: false,
    /** How many times a surface's offset facts changed — it came to wear an offset, lost it, its
     *  greatest offset or its program changed: what the roots' offsets are read again by
     *  (`../../frame/render/offsetReach.ts`). */
    offsetEpoch: 0,
    /** Whether a surface that dithers its cutout (`ditherOpacityMask`) was written: the blue noise is
     *  asked of the device then. Never unset. */
    dithers: false,
    /** Whether a surface drawn on both sides (`side: 'double'`, the rows' `FLAG_DOUBLE`) was written:
     *  the shadow raster makes the pipelines of its two-sided tiers then. Never unset. */
    twoSided: false,
    journal: undefined as Set<PageSurface> | undefined,
  }
}
export type MaterialRecords = ReturnType<typeof createMaterialRecords>
