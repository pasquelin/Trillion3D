import { hasPhysicalLobes } from '../../scene/physicalLobes.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { extendSpan } from '../../../../math/src/sequence/span.ts'
import type { MaterialLayers } from '../row/pageRowMaterial.ts'
import { writeMaterialRecord, type MaterialSurface } from './materialRecord.ts'
import { MATERIAL_RECORD_TEXELS, MATERIAL_RECORD_WORDS } from './materialLayout.ts'
import { LOBE_RECORD_TEXELS, writeLobeRecord } from './lobeRecord.ts'
import type { MaterialEntry, MaterialRecords } from './materialState.ts'

/** Lobe extensions one record's place holds: three of three texels in its ten. */
const LOBES_PER_SLOT = Math.floor(MATERIAL_RECORD_TEXELS / LOBE_RECORD_TEXELS)

/** A record's rank: one the collector freed, else the next, the words grown to hold it — a power
 *  of two records, so past one row a whole number of rows. */
export function takeRank(p: MaterialRecords) {
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

/** The record of `mat` written now, and its lobe extension where it carries a lobe — a surface that
 *  lost its lobes gives its extension back. Returns whether a word of either changed. */
export function writeEntry(
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
  let lobes = 0,
    changed = false
  if (entry.lobes >= 0) {
    const texel = lobeTexel(p, entry.lobes)
    if (writeLobeRecord(p.ints, texel * 4, mat, layers.dataLayer)) {
      extendSpan(p.written, Math.floor(texel / MATERIAL_RECORD_TEXELS))
      changed = true
    }
    lobes = texel + 1
  }
  if (writeMaterialRecord(p.ints, entry.rank * MATERIAL_RECORD_WORDS, mat, layers, lobes)) {
    extendSpan(p.written, entry.rank)
    changed = true
  }
  return changed
}
