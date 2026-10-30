/**
 * A compile job's temporal anti-aliasing settings as a host names them, and the functions that
 * turn them into the form the compiler reads.
 *
 * `temporalAntialiasing` sets the scene's quality level (`TEMPORAL_AA_LEVELS`, `true` the default
 * level, `false` off), written in its manifest: the runtime's `'scene'` setting.
 *
 * Each material's responsiveness — how far the temporal anti-aliasing trusts the history on its
 * pixels, a level of `RESPONSIVE_LEVELS`: `off` the normal accumulation, `medium`, `full` — is
 * resolved by the compiler once, the first source naming it winning:
 * 1. `materials[name].responsive`, by the material's exact name: a level, `true` for
 *    `DEFAULT_RESPONSIVE_LEVEL`, `false` for `off`;
 * 2. `responsive` — a match on the objects, as one HLOD group names its objects: the materials of
 *    every object it matches, only those its `material` pattern names where it has one —:
 *    `DEFAULT_RESPONSIVE_LEVEL`;
 * 3. the material's own `extras.responsive` in the glTF (`RESPONSIVE_EXTRA`), a level, `true` or
 *    `false` as in 1;
 * 4. `off`.
 *
 * Each material's sky property — the material of a sky dome mesh, which the engine shows as its colour
 * alone, draws as the sky after the opaque surfaces and captures in place of the atmosphere in the
 * sky light's real-time capture — is a boolean resolved the same way, the first source naming it
 * winning: `materials[name].sky`, then the material's own `extras.sky` (`SKY_EXTRA`), then `false`.
 *
 * A job naming none of them compiles as before. A value left out or `null` names nothing, as the
 * compiler reads it.
 */
import {
  DEFAULT_RESPONSIVE_LEVEL,
  DEFAULT_TEMPORAL_AA_LEVEL,
  MATERIAL_SETTINGS,
  MATERIALS_FIELD,
  MATERIALS_OPTION,
  RESPONSIVE_FIELD,
  RESPONSIVE_LEVELS,
  RESPONSIVE_OPTION,
  SKY_EXTRA,
  TEMPORAL_AA_FIELD,
  TEMPORAL_AA_LEVELS,
  TEMPORAL_AA_OPTION,
  type MaterialSettingsWire,
  type ResponsiveLevel,
  type TemporalAntialiasingLevel,
} from './compilerAbi.ts'
import {
  fieldsOf,
  isRecord,
  jsonJobOption,
  matchResolver,
  refusal,
  type NameMatch,
  type NamePattern,
  type Refuse,
} from './nameMatch.ts'

/** The objects whose materials keep a responsive history: a node's name (a string, exact), a
 *  regular expression on it, or a match on what the glTF carries (`NameMatch`). */
export type ResponsiveOption = NamePattern | NameMatch

/** A material's responsiveness as a host names it: a level of `RESPONSIVE_LEVELS`, `true` for
 *  `DEFAULT_RESPONSIVE_LEVEL`, `false` for `off`. */
export type ResponsiveSetting = ResponsiveLevel | boolean

/** One material's settings: `responsive`, its temporal responsiveness; `sky`, whether it is a sky
 *  material (a boolean, `false` by default). */
export type MaterialSettings = {
  responsive?: ResponsiveSetting
  sky?: boolean
}

/** The settings of materials, by their exact names in the glTF. */
export type MaterialsOption = Readonly<Record<string, MaterialSettings>>

/** The scene's temporal anti-aliasing: a quality level, `true` the default one, `false` off. */
export type TemporalAntialiasingOption = TemporalAntialiasingLevel | boolean

/**
 * The level `setting` names among `levels`: a level by its name, `true` the level `fallback`, `false`
 * the first of `levels`, the one that is off — the one reading of a scene's level and of a
 * material's, as the compiler reads both (`level_among`).
 * @param what - What names it, for the refusal.
 * @throws TypeError naming the levels when it is none of them.
 */
function levelAmong<L extends string>(
  setting: unknown,
  levels: readonly L[],
  fallback: L,
  what: string,
): L {
  if (setting === true) return fallback
  if (setting === false) return levels[0]
  if ((levels as readonly unknown[]).includes(setting)) return setting as L
  return refusal(what)(`must be one of ${levels.join(', ')}, true or false, got ${String(setting)}`)
}

/**
 * The scene's temporal anti-aliasing level the compiler writes for `option`: none when left out.
 * @param option - A level of `TEMPORAL_AA_LEVELS`, `true` (the default level) or `false` (off).
 * @returns The level, `undefined` for none.
 * @throws TypeError naming the levels when it is none of them.
 */
export function resolveTemporalAntialiasing(
  option?: TemporalAntialiasingOption | null,
): TemporalAntialiasingLevel | undefined {
  if (option === undefined || option === null) return undefined
  return levelAmong(option, TEMPORAL_AA_LEVELS, DEFAULT_TEMPORAL_AA_LEVEL, 'temporalAntialiasing')
}

/**
 * The level a runtime option names: `undefined` or `null` the default level, as `true`; `false`
 * off; a level as itself (`resolveTemporalAntialiasing`). The one reading of the runtime's
 * option, whoever takes it — the world, a view, a session.
 * @throws TypeError naming the levels when it is none of them.
 */
export function temporalAntialiasingLevel(
  option?: TemporalAntialiasingOption | null,
): TemporalAntialiasingLevel {
  return resolveTemporalAntialiasing(option) ?? DEFAULT_TEMPORAL_AA_LEVEL
}

/**
 * A material's responsiveness as its level: a level of `RESPONSIVE_LEVELS`, `true` the default
 * level (`DEFAULT_RESPONSIVE_LEVEL`), `false` `off`.
 * @param setting - The level, by name or by boolean.
 * @param what - What names it, for the refusal.
 * @throws TypeError naming the levels when it is none of them.
 */
export function responsiveLevel(setting: unknown, what = 'responsive'): ResponsiveLevel {
  return levelAmong(setting, RESPONSIVE_LEVELS, DEFAULT_RESPONSIVE_LEVEL, what)
}

/**
 * The responsive match the compiler reads for `option`: none when left out.
 * @param option - The objects, by name or by match, or none.
 * @returns The compiler's form (`HlodWireMatch`), `undefined` for none.
 * @throws TypeError naming what the host wrote wrong.
 */
export const resolveResponsive = matchResolver<ResponsiveOption>('responsive')

/**
 * The material settings the compiler reads for `option`: none when left out; each entry holding
 * only `MATERIAL_SETTINGS`, `responsive` as the name of its level and `sky` as a boolean.
 * @param option - The settings by material name, or none.
 * @returns The compiler's form, `undefined` for none.
 * @throws TypeError naming what the host wrote wrong.
 */
export function resolveMaterials(
  option?: MaterialsOption | null,
): Record<string, MaterialSettingsWire> | undefined {
  if (option === undefined || option === null) return undefined
  const refuse: Refuse = refusal('materials')
  if (!isRecord(option)) refuse('must be an object of settings by material name')
  return Object.fromEntries(
    Object.entries(option).map(([name, settings]) => {
      const what = `materials.${name}`
      const fields = fieldsOf(settings, MATERIAL_SETTINGS, what, refuse)
      const wire: MaterialSettingsWire = {}
      if (fields.responsive != null)
        wire.responsive = responsiveLevel(fields.responsive, `${what}.responsive`)
      if (fields.sky != null) {
        if (typeof fields.sky !== 'boolean') refuse(`${what}.${SKY_EXTRA} must be true or false`)
        wire.sky = fields.sky
      }
      return [name, wire]
    }),
  )
}

/** The temporal anti-aliasing options of a job. */
export type MaterialJobOptions = {
  temporalAntialiasing?: TemporalAntialiasingOption | null
  responsive?: ResponsiveOption | null
  materials?: MaterialsOption | null
}

/** A job's scene temporal anti-aliasing level as the job field and the command line's flag the
 *  compiler reads: left out, none, when the job names none. */
const temporalAntialiasingJob = {
  fields(job: MaterialJobOptions) {
    const level = resolveTemporalAntialiasing(job.temporalAntialiasing)
    return level ? { [TEMPORAL_AA_FIELD]: level } : {}
  },
  flags(job: MaterialJobOptions): string[] {
    const level = resolveTemporalAntialiasing(job.temporalAntialiasing)
    return level ? [`${TEMPORAL_AA_OPTION}${level}`] : []
  },
}
/** A job's `responsive` and `materials` as job fields and flags (`jsonJobOption`). */
const responsiveJob = jsonJobOption(RESPONSIVE_FIELD, RESPONSIVE_OPTION, resolveResponsive)
const materialsJob = jsonJobOption(MATERIALS_FIELD, MATERIALS_OPTION, resolveMaterials)

/** A job's temporal anti-aliasing options as the compiler reads them (`fields`) and as the command
 *  line's flags (`flags`), each left out when the job names none. */
export const materialJob = {
  fields: (job: MaterialJobOptions) => ({
    ...temporalAntialiasingJob.fields(job),
    ...responsiveJob.fields(job),
    ...materialsJob.fields(job),
  }),
  flags: (job: MaterialJobOptions): string[] => [
    ...temporalAntialiasingJob.flags(job),
    ...responsiveJob.flags(job),
    ...materialsJob.flags(job),
  ],
}
