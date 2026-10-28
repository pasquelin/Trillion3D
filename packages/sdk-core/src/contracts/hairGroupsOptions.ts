/**
 * A compile job's settings for the groups of a groom, as a host names them, and the function that turns
 * them into the form the compiler reads (`args/hair_strands.rs`): an object whose keys are group numbers
 * (the whole numbers the curves of a scene are cut into groups by) and whose values name, for that group,
 * whether it is drawn stable (`stableRasterization`: a group of hairs does not alias, and may look
 * thicker) and whether it lights the scene behind it (`scatterSceneLighting`: short hair that takes the
 * light of the surface under it, as skin does). A setting a job leaves out follows the project's
 * (`hairStableRasterization`, `hairScatterSceneLighting`); a group the job does not name follows both. A job
 * that names no group keeps its cache key.
 */
import { HAIR_STRANDS_GROUPS_FIELD, HAIR_STRANDS_GROUPS_OPTION } from './hairStrandsAbi.ts'
import { isRecord, jsonJobOption, refusal } from './nameMatch.ts'

/** The settings of one group as a host writes them. */
export interface HairGroupOption {
  stableRasterization?: boolean | null
  scatterSceneLighting?: boolean | null
}

/** The groups' settings as a host writes them, by group number. */
export type HairGroupsOption = Readonly<Record<string, HairGroupOption>>

/** The settings of one group as the compiler reads them: only those the job named. */
export interface HairGroupWire {
  stableRasterization?: boolean
  scatterSceneLighting?: boolean
}

const SETTINGS = ['stableRasterization', 'scatterSceneLighting'] as const

/**
 * The settings the compiler reads for `option`: none when left out or empty.
 * @throws TypeError when it is not an object of objects, a key is not a whole number, a group names
 *  a setting but these two, or a setting is neither `true` nor `false`.
 */
function resolveHairGroups(
  option?: HairGroupsOption | null,
): Record<string, HairGroupWire> | undefined {
  if (option === undefined || option === null) return undefined
  const refuse = refusal(HAIR_STRANDS_GROUPS_FIELD)
  if (!isRecord(option)) return refuse('must be an object whose keys are group numbers')
  const wire: Record<string, HairGroupWire> = {}
  for (const [key, group] of Object.entries(option)) {
    if (!/^-?\d+$/.test(key) || Math.abs(Number(key)) > 2 ** 31 - 1)
      return refuse(`"${key}" is not a group number`)
    if (!isRecord(group)) return refuse(`group ${key} must be an object`)
    const named: HairGroupWire = {}
    for (const [name, value] of Object.entries(group)) {
      if (!(SETTINGS as readonly string[]).includes(name))
        return refuse(`group ${key} has no setting "${name}" (${SETTINGS.join(', ')})`)
      if (value === undefined || value === null) continue
      if (typeof value !== 'boolean') return refuse(`group ${key}: ${name} must be true or false`)
      named[name as (typeof SETTINGS)[number]] = value
    }
    if (Object.keys(named).length) wire[String(Number(key))] = named
  }
  return Object.keys(wire).length ? wire : undefined
}

/** A job's `hairGroups` as the job field and the command line's flag the compiler reads
 *  (`jsonJobOption`): `fields` left out, `flags` none, when the job names none. */
export const hairGroupsJob = jsonJobOption(
  HAIR_STRANDS_GROUPS_FIELD,
  HAIR_STRANDS_GROUPS_OPTION,
  resolveHairGroups,
)
