import { MATERIAL_SECOND_UV } from '../../visibility/types.ts'
import { surfaceJournals } from '../../page/surfaceWrites.ts'
import type { MaterialLayers } from '../row/pageRowMaterial.ts'
import type { MaterialSurface } from './materialRecord.ts'
import { MATERIAL_RECORD_WORDS } from './materialLayout.ts'
import { uploadMaterials } from './materialUpload.ts'
import { takeRank, writeEntry } from './materialWrite.ts'
import { summarize } from './materialSummary.ts'
import type { MaterialEntry, MaterialRecords } from './materialState.ts'

/**
 * THE MATERIAL TABLE: one record per surface alive (`materialRecord.ts`), in one `rgba32uint`
 * texture every pass that reads a material binds (`materialTableWgsl`) — a texture, not a storage
 * buffer, so no pass spends one of the eight storage buffers a stage is guaranteed. A page row, a
 * blend item and a shadow caster name their surface by rank (`word`), four bytes, and hold none of
 * its values: a material's edit writes its one record, and no row or item.
 *
 * A surface with an anisotropic or clear-coat lobe (`hasPhysicalLobes`) adds a lobe extension of
 * three texels, three to a record's place, which its record names (`lobes`): the surfaces without
 * one pay nothing for it.
 *
 * A record is written when its surface's version (`surfaceWritten`) or the atlases' slots
 * (`forget`) moved since, the texture only over the records that changed (`materialUpload.ts`).
 * `follow` writes the records of the surfaces written since it last ran, and says whether one of
 * them changed what its rows or items read beside the record (`materialSummary.ts`): only then are
 * they written again. An open world's surfaces come and go: the table holds none of them alive
 * (weak maps), and the rank of a surface the collector took — no page, row or item names it any
 * longer — is handed to the next surface, so the table is as tall as the surfaces alive.
 */
export function createMaterialTable() {
  const p: MaterialRecords = {
    ...{ entries: new WeakMap(), surfaces: [] },
    ...{ freed: [], lobesFreed: [], lobeSlots: [], lobesHeld: 0 },
    reclaim: new FinalizationRegistry<MaterialEntry>((entry) => release(p, entry)),
    ints: new Uint32Array(MATERIAL_RECORD_WORDS),
    ...{ held: 0, epoch: 0, written: { from: Infinity, to: -1 }, texture: undefined },
    ...{ moved: false, forgotten: false, journal: undefined },
  }
  const table = {
    view: undefined as GPUTextureView | undefined,
    /** The word a row or an item names `mat` by: its record's rank, `MATERIAL_SECOND_UV` set where
     *  its geometry is read as floats and carries a second UV set (`vertUv1`). The record is
     *  written first where the surface's version or the atlases' slots moved since. */
    word: (mat: MaterialSurface, layers: MaterialLayers, floatSecondUv = false) => {
      const rank = recordOf(p, mat, layers).rank
      return floatSecondUv ? (rank | MATERIAL_SECOND_UV) >>> 0 : rank
    },
    /** The records of the surfaces written since the last call, and of every surface after an
     *  atlas census (`forget`), written again; true when one changed what its rows or items read
     *  beside its record — their flags, their resolve class, a fact the frame derives from them —,
     *  which are then to be written again. */
    follow: (layers: MaterialLayers) => follow(p, layers),
    /** The atlases' slots moved — a census, a texture appended or released: every record is
     *  written again at the next `follow`, or at its surface's next read. */
    forget() {
      p.epoch++
      p.forgotten = true
    },
    /** Whether `upload` has records to send, or no texture yet. */
    get pending() {
      return p.written.from <= p.written.to || !p.texture
    },
    /** The view the passes bind, its texture made or grown to hold every record, and the records
     *  written since the last upload sent up. */
    upload: (device: GPUDevice) => uploadMaterials(p, table, device),
    /** The device's resources gone: the texture dropped, and the writes no longer followed — the
     *  records of the surfaces read after are written as their versions say. */
    dispose() {
      p.texture?.destroy()
      p.texture = table.view = undefined
      if (p.journal) surfaceJournals.close(p.journal)
      p.journal = undefined
    },
  }
  return table
}

export type MaterialTable = ReturnType<typeof createMaterialTable>

/** The entry of `mat`, its record written first where its version or the atlas moved. */
function recordOf(p: MaterialRecords, mat: MaterialSurface, layers: MaterialLayers) {
  let entry = p.entries.get(mat)
  if (!entry) {
    const rank = takeRank(p)
    entry = { rank, lobes: -1, version: undefined, epoch: -1, flags: 0, classKey: 0, facts: 0 }
    p.entries.set(mat, entry)
    p.surfaces[entry.rank] = new WeakRef(mat)
    p.reclaim.register(mat, entry)
  } else if (entry.version !== undefined && entry.version === mat.version) {
    if (entry.epoch === p.epoch) return entry
  }
  refresh(p, mat, entry, layers)
  return entry
}

/** The record of `mat` written again, and whether its rows' summary moved noted for `follow`. */
function refresh(
  p: MaterialRecords,
  mat: MaterialSurface,
  entry: MaterialEntry,
  layers: MaterialLayers,
) {
  const changed = writeEntry(p, mat, entry, layers)
  if (summarize(entry, mat, layers, changed)) p.moved = true
  entry.version = mat.version
  entry.epoch = p.epoch
}

/** The written surfaces' records, every one's after a census; whether a summary moved since. */
function follow(p: MaterialRecords, layers: MaterialLayers) {
  const journal = (p.journal ??= surfaceJournals.open())
  for (const mat of journal) {
    const entry = p.entries.get(mat)
    if (entry && entry.version !== mat.version) refresh(p, mat, entry, layers)
  }
  journal.clear()
  if (p.forgotten) {
    p.forgotten = false
    for (const held of p.surfaces) {
      const mat = held?.deref(),
        entry = mat && p.entries.get(mat)
      if (entry && entry.epoch !== p.epoch) refresh(p, mat, entry, layers)
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
  p.surfaces[entry.rank] = undefined
}
