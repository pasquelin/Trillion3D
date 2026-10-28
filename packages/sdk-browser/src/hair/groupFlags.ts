import {
  HAIR_STRANDS_FLAG_SCATTER,
  HAIR_STRANDS_FLAG_SCATTER_SET,
  HAIR_STRANDS_FLAG_STABLE,
  HAIR_STRANDS_FLAG_STABLE_SET,
} from '../../../sdk-core/src/contracts/hairStrandsAbi.ts'
import { HAIR_FLAG } from './materialMath.ts'

/** `flags` with the bit `bit` set or cleared as a group's `groupFlags` say, where they name it (`set`
 *  names it, `value` is its value): a group the job left alone follows the project's. */
const named = (flags: number, bit: number, groupFlags: number, set: number, value: number) =>
  groupFlags & set ? (flags & ~bit) | (groupFlags & value ? bit : 0) : flags

/** The flags of the strands of a group (`HAIR_FLAG`): the project's `flags` (`hairFlagsOf`), with the
 *  stable raster and scatter bits as the group's own `groupFlags` name them (`hairGroups`, the settings a
 *  job gives a group of a groom). */
export const hairGroupFlags = (groupFlags: number, flags: number) =>
  named(
    named(
      flags,
      HAIR_FLAG.stableRaster,
      groupFlags,
      HAIR_STRANDS_FLAG_STABLE_SET,
      HAIR_STRANDS_FLAG_STABLE,
    ),
    HAIR_FLAG.scatterSceneLight,
    groupFlags,
    HAIR_STRANDS_FLAG_SCATTER_SET,
    HAIR_STRANDS_FLAG_SCATTER,
  )
