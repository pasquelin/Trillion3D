import { MATERIAL_SECOND_UV } from '../../visibility/types.ts'
import { surfaceJournals } from '../../geometry/pages/surfaceWrites.ts'
import { variantPlain } from '../../geometry/pages/surfaceVariant.ts'
import type { MaterialLayers } from '../../geometry/rows/page/pageRowMaterial.ts'
import type { MaterialSurface } from './materialRecord.ts'
import { uploadMaterials } from './materialUpload.ts'
import { takeRank, writeEntry } from './materialWrite.ts'
import { summarize } from './materialSummary.ts'
import { freeGraphBlock } from './graphRecord.ts'
import {
  createMaterialRecords,
  surfaceSeen,
  type MaterialEntry,
  type MaterialRecords,
} from './materialState.ts'

/**
 * THE MATERIAL TABLE: one record per surface alive (`materialRecord.ts`), in one `rgba32uint`
 * texture every pass that reads a material binds (`materialTableWgsl`) — a texture, not a storage
 * buffer, so no pass spends one of the eight storage buffers a stage is guaranteed. A page row, a
 * blend item and a shadow caster name their surface by rank (`word`), four bytes, and hold none of
 * its values: a material's edit writes its one record, and no row or item.
 *
 * A surface with an anisotropic, clear-coat or cloth lobe (`hasPhysicalLobes`) adds a lobe extension of
 * five texels, two to a record's place, which its record names (`lobes`): the surfaces without
 * one pay nothing for it.
 *
 * A record is written when its surface's version (`surfaceWritten`) or the atlases' slots
 * (`forget`) moved since, the texture only over the records that changed (`materialUpload.ts`),
 * grown on the GPU.
 * `follow` writes the records of the surfaces written since it last ran, and says whether one of
 * them changed what its rows or items read beside the record (`materialSummary.ts`): only then are
 * they written again. An open world's surfaces come and go: the table holds none of them alive
 * (weak maps), and the rank of a surface the collector took — no page, row or item names it any
 * longer — is handed to the next surface, so the table is as tall as the surfaces alive.
 */
export function createMaterialTable() {
  const p = createMaterialRecords((entry) => release(p, entry))
  const table = {
    /** The view the passes bind, none before the first upload: a new one when the table grew. */
    get view() {
      return p.records?.view
    },
    /** What the table holds of `mat` (`SurfaceSeen`): its record's rank, and what it brings to each
     *  of its rows (`row`), which a row write reads instead of its maps — written first, with its
     *  record, where its version or the atlases' slots moved since. */
    surface(mat: MaterialSurface, layers: MaterialLayers) {
      recordOf(p, mat, layers)
      // Written by `refresh` at the latest above.
      return p.seen.get(mat)!
    },
    /** The displaced surfaces' records by rank, which the tessellation binds beside the table
     *  (`displacementRecord.ts`); empty while no surface is displaced. */
    get displaced() {
      return p.displaced
    },
    /** The records of the surfaces written since the last call, and of every surface after an
     *  atlas census (`forget`), written again; true when one changed what its rows or items read
     *  beside its record — their flags, their resolve class, a fact the frame derives from them —,
     *  which are then to be written again. */
    follow: (layers: MaterialLayers) => follow(p, layers),
    /** Whether a surface that dithers its cutout was written (`MaterialRecords.dithers`). */
    get dithers() {
      return p.dithers
    },
    /** How many times a surface's offset facts changed (`MaterialRecords.offsetEpoch`). */
    get offsetEpoch() {
      return p.offsetEpoch
    },
    /** The atlases' slots moved — a census, a texture appended or released: every record is
     *  written again at the next `follow`, or at its surface's next read. */
    forget() {
      p.epoch++
      p.forgotten = true
    },
    /** The view the passes bind, its texture made or grown to hold every record, and the records
     *  written since the last call sent up — nothing sent when none was: the one call every pass
     *  makes before a group names the texture (`uploadMaterials`). */
    viewFor: (device: GPUDevice) => uploadMaterials(p, device),
    /** The device's resources gone: the texture dropped, and the writes no longer followed — the
     *  records of the surfaces read after are written as their versions say. */
    dispose() {
      p.records?.destroy()
      p.records = undefined
      if (p.journal) surfaceJournals.close(p.journal)
      p.journal = undefined
    },
  }
  return table
}

export type MaterialTable = ReturnType<typeof createMaterialTable>

/** The word a row or an item names the record of rank `rank` by: `MATERIAL_SECOND_UV` set where its
 *  geometry is read as floats and carries a second UV set (`vertUv1`). */
export const materialWord = (rank: number, floatSecondUv: boolean) =>
  floatSecondUv ? (rank | MATERIAL_SECOND_UV) >>> 0 : rank

/** The entry of `mat`'s record — its material's, shared by its variants (`variantPlain`): their
 *  values are one —, written first from `mat` where its version or the atlas moved since. */
function recordOf(p: MaterialRecords, mat: MaterialSurface, layers: MaterialLayers) {
  const plain = variantPlain(mat)
  let entry = p.entries.get(plain)
  if (!entry) {
    entry = { rank: takeRank(p), lobes: -1, graph: undefined, epoch: -1, source: undefined }
    p.entries.set(plain, entry)
    p.surfaces[entry.rank] = new WeakRef(plain)
    p.reclaim.register(plain, entry)
  } else {
    const seen = p.seen.get(mat)
    if (seen && seen.version !== undefined && seen.version === mat.version)
      if (seen.epoch === p.epoch && entry.epoch === p.epoch) return entry
  }
  refresh(p, mat, entry, layers)
  return entry
}

/** The record written again from `mat`, and whether its rows' summary moved noted for `follow`. */
function refresh(
  p: MaterialRecords,
  mat: MaterialSurface,
  entry: MaterialEntry,
  layers: MaterialLayers,
) {
  const changed = writeEntry(p, mat, entry, layers)
  let seen = p.seen.get(mat)
  const first = !seen
  if (!seen) {
    seen = surfaceSeen(entry.rank)
    p.seen.set(mat, seen)
  }
  if (mat.ditherOpacityMask === true) p.dithers = true
  const { wpo, wpoMost, graph } = seen.row
  if (summarize(seen, mat, layers, changed, first)) p.moved = true
  // A surface that wears no offset, and wore none, is no change of the roots' offsets.
  if (
    wpo !== seen.row.wpo ||
    (seen.row.wpo !== 0 && (wpoMost !== seen.row.wpoMost || graph !== seen.row.graph))
  )
    p.offsetEpoch++
  seen.version = mat.version
  seen.epoch = entry.epoch = p.epoch
  if (entry.source?.deref() !== mat) entry.source = new WeakRef(mat)
}

/** The written surfaces' records, every one's after a census; whether a summary moved since. */
function follow(p: MaterialRecords, layers: MaterialLayers) {
  const journal = (p.journal ??= surfaceJournals.open())
  for (const mat of journal) {
    const entry = p.entries.get(variantPlain(mat))
    if (entry && p.seen.get(mat)?.version !== mat.version) refresh(p, mat, entry, layers)
  }
  journal.clear()
  if (p.forgotten) {
    p.forgotten = false
    for (const held of p.surfaces) {
      const plain = held?.deref(),
        entry = plain && p.entries.get(plain)
      // Written again from the surface it was last written from: the one whose values are current.
      const mat = entry && (entry.source?.deref() ?? (plain as MaterialSurface))
      if (entry && mat && entry.epoch !== p.epoch) refresh(p, mat, entry, layers)
    }
  }
  const moved = p.moved
  p.moved = false
  return moved
}

/** The places of a surface the collector took, handed out again. */
function release(p: MaterialRecords, entry: MaterialEntry) {
  p.freed.push(entry.rank)
  if (entry.lobes >= 0) p.lobesFreed.push(entry.lobes)
  freeGraphBlock(p, entry)
  p.surfaces[entry.rank] = undefined
}
