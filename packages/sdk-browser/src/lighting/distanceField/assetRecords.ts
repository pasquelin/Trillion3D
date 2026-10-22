import { mipOf, type AssetState } from './atlasState.ts'
import {
  ASSET_MIPS_SHIFT,
  ASSET_MIP_STRIDE,
  ASSET_STRIDE,
  INDIRECTION_SIDE_BITS,
} from './layout.ts'
import type { RecordWords } from './objectRecords.ts'

/**
 * A MESH'S RECORDS FOR THE GPU, one for each mip it holds (`layout.ts`, read by `meshFieldWgsl.ts`):
 * the sides of its indirection table, the number of mips the mesh holds (in the record of the
 * coarsest, the one the programs read it from), where its table starts, the scale that takes a
 * position of its volume to a cell of the table, and the scale and bias that take a stored byte to
 * a distance. The record of an asset that is gone, or of a mip it does not hold, is zero.
 */

/** Writes the record of `asset`'s reversed mip `reversed` (coarsest first) at its place in
 *  `words`; `state` is the asset as the atlas holds it, none for an asset that is gone. */
export function writeAssetRecord(
  words: RecordWords,
  asset: number,
  reversed: number,
  state: AssetState | undefined,
) {
  const at = (asset * ASSET_STRIDE + reversed * ASSET_MIP_STRIDE) * 4
  words.u32.fill(0, at, at + ASSET_MIP_STRIDE * 4)
  const held = state?.mips[reversed]
  if (!state || !held) return
  const mip = mipOf(state.field, reversed)
  const [x, y, z] = mip.indirectionSize
  const bits = INDIRECTION_SIDE_BITS
  words.u32[at] =
    (x | (y << bits) | (z << (2 * bits)) | (state.mips.length << ASSET_MIPS_SHIFT)) >>> 0
  words.u32[at + 1] = held.tableOffset
  words.f32.set(
    [
      mip.volumeToVirtualUvScale[0] * x,
      mip.volumeToVirtualUvScale[1] * y,
      mip.volumeToVirtualUvScale[2] * z,
      mip.distanceScale,
      mip.volumeToVirtualUvAdd[0] * x,
      mip.volumeToVirtualUvAdd[1] * y,
      mip.volumeToVirtualUvAdd[2] * z,
      mip.distanceBias,
    ],
    at + 4,
  )
}
