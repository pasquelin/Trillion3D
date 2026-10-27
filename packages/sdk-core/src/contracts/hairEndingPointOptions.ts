/**
 * A compile job's hair strands ending point as a host names it, and the function that turns it into
 * the form the compiler reads (`args/hair_strands.rs`): `true` gives each curve of a groom one
 * control point more at its end, so that a strip of triangles drawn from the points keeps the last
 * segment of the curve, `false` gives none, and a job that names none gives it. A job that gives
 * it, named or not, keeps its cache key.
 */
import {
  HAIR_STRANDS_ENDING_POINT_FIELD,
  HAIR_STRANDS_ENDING_POINT_OPTION,
} from './hairStrandsAbi.ts'
import { jsonJobOption, refusal } from './nameMatch.ts'

/** The ending point as a host writes it. */
export type HairEndingPointOption = boolean

/**
 * The value the compiler reads for `option`: none when left out.
 * @throws TypeError when it is neither `true` nor `false`.
 */
function resolveHairEndingPoint(option?: HairEndingPointOption | null): boolean | undefined {
  if (option === undefined || option === null) return undefined
  if (typeof option !== 'boolean')
    return refusal(HAIR_STRANDS_ENDING_POINT_FIELD)('must be true or false')
  return option
}

/** A job's `hairEndingPoint` as the job field and the command line's flag the compiler reads
 *  (`jsonJobOption`): `fields` left out, `flags` none, when the job names none. */
export const hairEndingPointJob = jsonJobOption(
  HAIR_STRANDS_ENDING_POINT_FIELD,
  HAIR_STRANDS_ENDING_POINT_OPTION,
  resolveHairEndingPoint,
)
