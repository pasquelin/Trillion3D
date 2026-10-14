import { hasPhysicalLobes } from '../../scene/physicalLobes.ts'
import { MATERIAL_SECOND_UV } from '../../visibility/types.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { extendSpan } from '../../../../math/src/sequence/span.ts'
import type { MaterialLayers } from '../row/pageRowMaterial.ts'
import {
  MATERIAL_RECORD_TEXELS,
  MATERIAL_RECORD_WORDS,
  writeMaterialRecord,
  type MaterialSurface,
} from './materialRecord.ts'
import { LOBE_RECORD_TEXELS, writeLobeRecord } from './lobeRecord.ts'
import { uploadMaterials, type MaterialEntry, type MaterialRecords } from './materialUpload.ts'

/** Lobe extensions one record's place holds: three of three texels in its ten. */
const LOBES_PER_SLOT = Math.floor(MATERIAL_RECORD_TEXELS / LOBE_RECORD_TEXELS)

/**
 * THE MATERIAL TABLE: one record per surface alive (`materialRecord.ts`), in one `rgba32uint`
 * texture every pass that reads a material binds (`materialTableWgsl`) — a texture, not a storage
 * buffer, so no pass spends one of the eight storage buffers a stage is guaranteed. A page row, a
 * blend item and a water volume name their surface by rank (`word`), four bytes, and hold none of
 * its values: a material's edit writes its one record, and no row or item.
 *
 * A surface with an anisotropic or clear-coat lobe (`hasPhysicalLobes`) adds a lobe extension of
 * three texels, three to a record's place, which its record names (`lobes`): the surfaces without
 * one pay nothing for it.
 *
 * A record is written when its surface's version (`surfaceWritten`) or the atlases' slots
 * (`forget`) moved since, the texture only over the records that changed (`materialUpload.ts`).
 * An open world's surfaces come and go: the table holds none of them alive (weak maps), and the
 * rank of a surface the collector took — no page, row or item names it any longer — is handed to
 * the next surface, so the table is as tall as the surfaces alive, not as all seen.
 */
export function createMaterialTable() {
  const p: MaterialRecords = {
    entries: new WeakMap(),
    ...{ freed: [], lobesFreed: [], lobeSlots: [], lobesHeld: 0 },
    reclaim: new FinalizationRegistry<MaterialEntry>((entry) => release(p, entry)),
    ints: new Uint32Array(MATERIAL_RECORD_WORDS),
    ...{ held: 0, epoch: 0, written: { from: Infinity, to: -1 }, texture: undefined },
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
    /** The atlases' slots moved — a census, a texture appended or released: every record is
     *  written again at its surface's next read. */
    forget() {
      p.epoch++
    },
    /** Whether `upload` has records to send, or no texture yet. */
    get pending() {
      return p.written.from <= p.written.to || !p.texture
    },
    /** The view the passes bind, its texture made or grown to hold every record, and the records
     *  written since the last upload sent up. */
    upload: (device: GPUDevice) => uploadMaterials(p, table, device),
    dispose() {
      p.texture?.destroy()
      p.texture = table.view = undefined
    },
  }
  return table
}

export type MaterialTable = ReturnType<typeof createMaterialTable>

/** The entry of `mat`, its record written first where its version or the atlas moved. */
function recordOf(p: MaterialRecords, mat: MaterialSurface, layers: MaterialLayers) {
  let entry = p.entries.get(mat)
  if (!entry) {
    entry = { rank: takeRank(p), lobes: -1, version: undefined, epoch: -1 }
    p.entries.set(mat, entry)
    p.reclaim.register(mat, entry)
  } else if (entry.version !== undefined && entry.version === mat.version) {
    if (entry.epoch === p.epoch) return entry
  }
  write(p, mat, entry, layers)
  entry.version = mat.version
  entry.epoch = p.epoch
  return entry
}

/** A record's rank: one the collector freed, else the next, the words grown to hold it — a power
 *  of two records, so past one row a whole number of rows. */
function takeRank(p: MaterialRecords) {
  const rank = p.freed.pop() ?? p.held++
  p.ints = resized(p.ints, (rank + 1) * MATERIAL_RECORD_WORDS)
  return rank
}

/** The first texel of lobe extension `index`, in the place of a record taken for its three. */
function lobeTexel(p: MaterialRecords, index: number) {
  const slot = Math.floor(index / LOBES_PER_SLOT)
  p.lobeSlots[slot] ??= takeRank(p)
  return p.lobeSlots[slot] * MATERIAL_RECORD_TEXELS + (index % LOBES_PER_SLOT) * LOBE_RECORD_TEXELS
}

/** The record of `mat` written now, and its lobe extension where it carries a lobe. */
function write(
  p: MaterialRecords,
  mat: MaterialSurface,
  entry: MaterialEntry,
  layers: MaterialLayers,
) {
  const lobed = hasPhysicalLobes(mat)
  if (lobed && entry.lobes < 0) entry.lobes = p.lobesFreed.pop() ?? p.lobesHeld++
  if (!lobed && entry.lobes >= 0) {
    p.lobesFreed.push(entry.lobes)
    entry.lobes = -1
  }
  let lobes = 0
  if (entry.lobes >= 0) {
    const texel = lobeTexel(p, entry.lobes)
    if (writeLobeRecord(p.ints, texel * 4, mat, layers.dataLayer))
      extendSpan(p.written, Math.floor(texel / MATERIAL_RECORD_TEXELS))
    lobes = texel + 1
  }
  if (writeMaterialRecord(p.ints, entry.rank * MATERIAL_RECORD_WORDS, mat, layers, lobes))
    extendSpan(p.written, entry.rank)
}

/** The places of a surface the collector took, handed out again. */
function release(p: MaterialRecords, entry: MaterialEntry) {
  p.freed.push(entry.rank)
  if (entry.lobes >= 0) p.lobesFreed.push(entry.lobes)
}
