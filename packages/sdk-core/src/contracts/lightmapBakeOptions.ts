/**
 * A compile job's volumetric lightmap bake as a host names it, and the function that turns it into
 * the form the compiler reads (`args/lightmap_bake.rs`): `true` the reference's settings, `false`
 * or none no bake, or an object of the settings (`lightmapBakeAbi.ts`), each left out for its
 * default, the boxes the volume covers and the sky light it shines. A job naming none compiles as before, its cache key
 * unchanged.
 */
import {
  LIGHTMAP_BAKE_FIELD,
  LIGHTMAP_BAKE_OPTION,
  LIGHTMAP_BAKE_RULES,
  LIGHTMAP_BAKE_SETTINGS,
  LIGHTMAP_BAKE_SKY,
  LIGHTMAP_BAKE_SKY_RULES,
  LIGHTMAP_BAKE_SKY_SETTINGS,
  LIGHTMAP_BAKE_VOLUMES,
  type LightmapBakeOption,
  type LightmapBakeSky,
  type LightmapBakeVolume,
  type LightmapBakeWire,
} from './lightmapBakeAbi.ts'
import { fieldsOf, isRecord, jsonJobOption, refusal, type Refuse } from './nameMatch.ts'
import { resolveNamed } from './settingRules.ts'
import { isFiniteNumber } from '../../../math/src/scalar/reals.ts'

const finite3 = (value: unknown): value is readonly [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)

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

/** The sky light `value` names: none for none or `false`, `true` its defaults, an object the settings it names, each within its rule. */
function resolveSky(value: unknown, refuse: Refuse): true | LightmapBakeSky | undefined {
  if (value === undefined || value === null || value === false) return undefined
  if (value === true) return true
  const what = `${LIGHTMAP_BAKE_FIELD}.${LIGHTMAP_BAKE_SKY}`
  if (!isRecord(value)) return refuse(`${what} must be true, false or an object of settings`)
  const fields = fieldsOf(value, [...LIGHTMAP_BAKE_SKY_SETTINGS], what, refuse)
  return resolveNamed(LIGHTMAP_BAKE_SKY_RULES, fields) as LightmapBakeSky
}

/**
 * The bake the compiler reads for `option`: none when left out or `false`; `true` the defaults;
 * an object, the settings it names, each within its rule's range.
 * @throws TypeError naming the setting and what it takes when one is wrong.
 */
function resolveLightmapBake(
  option?: LightmapBakeOption | null,
): true | LightmapBakeWire | undefined {
  if (option === undefined || option === null || option === false) return undefined
  if (option === true) return true
  const refuse = refusal(LIGHTMAP_BAKE_FIELD)
  if (!isRecord(option)) return refuse('must be true, false or an object of settings')
  const fields = fieldsOf(
    option,
    [...LIGHTMAP_BAKE_SETTINGS, LIGHTMAP_BAKE_VOLUMES, LIGHTMAP_BAKE_SKY],
    LIGHTMAP_BAKE_FIELD,
    refuse,
  )
  const wire = resolveNamed(LIGHTMAP_BAKE_RULES, fields)
  const volumes = fields[LIGHTMAP_BAKE_VOLUMES]
  if (volumes !== undefined && volumes !== null)
    wire[LIGHTMAP_BAKE_VOLUMES] = resolveVolumes(volumes, refuse)
  const sky = resolveSky(fields[LIGHTMAP_BAKE_SKY], refuse)
  if (sky !== undefined) wire[LIGHTMAP_BAKE_SKY] = sky
  return wire as LightmapBakeWire
}

/** A job's `lightmapBake` as the job field and the command line's flag the compiler reads
 *  (`jsonJobOption`): `fields` left out, `flags` none, when the job names none. */
export const lightmapBakeJob = jsonJobOption(
  LIGHTMAP_BAKE_FIELD,
  LIGHTMAP_BAKE_OPTION,
  resolveLightmapBake,
)
