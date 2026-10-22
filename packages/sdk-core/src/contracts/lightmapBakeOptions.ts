/**
 * A compile job's volumetric lightmap bake as a host names it, and the function that turns it into
 * the form the compiler reads (`args/lightmap_bake.rs`): `true` the reference's settings, `false`
 * or none no bake, or an object of the settings (`lightmapBakeAbi.ts`), each left out for its
 * default, and the boxes the volume covers. A job naming none compiles as before, its cache key
 * unchanged.
 */
import {
  LIGHTMAP_BAKE_FIELD,
  LIGHTMAP_BAKE_OPTION,
  LIGHTMAP_BAKE_RULES,
  LIGHTMAP_BAKE_SETTINGS,
  LIGHTMAP_BAKE_VOLUMES,
  type LightmapBakeOption,
  type LightmapBakeVolume,
  type LightmapBakeWire,
} from './lightmapBakeAbi.ts'
import { fieldsOf, isRecord, jsonJobOption, refusal, type Refuse } from './nameMatch.ts'
import { resolveSetting } from './settingRules.ts'

const finite3 = (value: unknown): value is readonly [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((part) => typeof part === 'number' && Number.isFinite(part))

/** The boxes `value` names, each a lower then an upper corner above it. */
function resolveVolumes(value: unknown, refuse: Refuse): LightmapBakeVolume[] {
  const what = `${LIGHTMAP_BAKE_FIELD}.${LIGHTMAP_BAKE_VOLUMES}`
  if (!Array.isArray(value)) return refuse(`${what} must be an array of boxes`)
  return value.map((box: unknown, at) => {
    const [low, high] = Array.isArray(box) ? box : []
    if (!finite3(low) || !finite3(high) || (box as unknown[]).length !== 2)
      return refuse(`${what}[${at}] must be a lower and an upper corner, three numbers each`)
    if (low.some((part, k) => !(part < high[k])))
      return refuse(`${what}[${at}] must have its upper corner above its lower`)
    return [low, high] as LightmapBakeVolume
  })
}

/**
 * The bake the compiler reads for `option`: none when left out or `false`; `true` the defaults;
 * an object, the settings it names, each within its rule's range.
 * @throws TypeError naming the setting and what it takes when one is wrong.
 */
export function resolveLightmapBake(
  option?: LightmapBakeOption | null,
): true | LightmapBakeWire | undefined {
  if (option === undefined || option === null || option === false) return undefined
  if (option === true) return true
  const refuse = refusal(LIGHTMAP_BAKE_FIELD)
  if (!isRecord(option)) return refuse('must be true, false or an object of settings')
  const fields = fieldsOf(
    option,
    [...LIGHTMAP_BAKE_SETTINGS, LIGHTMAP_BAKE_VOLUMES],
    LIGHTMAP_BAKE_FIELD,
    refuse,
  )
  const wire: Record<string, unknown> = {}
  for (const field of LIGHTMAP_BAKE_SETTINGS) {
    const named = fields[field]
    if (named === undefined || named === null) continue
    // `resolveSetting` refuses a value the rule does not take, naming the field.
    wire[field] = resolveSetting(LIGHTMAP_BAKE_RULES[field], named as never)
  }
  const volumes = fields[LIGHTMAP_BAKE_VOLUMES]
  if (volumes !== undefined && volumes !== null)
    wire[LIGHTMAP_BAKE_VOLUMES] = resolveVolumes(volumes, refuse)
  return wire as LightmapBakeWire
}

/** A job's `lightmapBake` as the job field and the command line's flag the compiler reads
 *  (`jsonJobOption`): `fields` left out, `flags` none, when the job names none. */
export const lightmapBakeJob = jsonJobOption(
  LIGHTMAP_BAKE_FIELD,
  LIGHTMAP_BAKE_OPTION,
  resolveLightmapBake,
)
