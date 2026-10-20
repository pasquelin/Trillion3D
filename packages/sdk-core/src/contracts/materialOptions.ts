/**
 * A compile job's temporal anti-aliasing settings as a host names them, and the functions that
 * turn them into the form the compiler reads.
 *
 * `temporalAntialiasing` sets the scene's quality level (`TEMPORAL_AA_LEVELS`, `true` the default
 * level, `false` off), written in its manifest: the runtime's `'scene'` setting.
 *
 * Each material's history share — the most of its history the temporal anti-aliasing keeps on its
 * pixels, a number in [0, 1] or a name of `TEMPORAL_AA_SHARES`, 1 the engine's own blend — is
 * resolved by the compiler once, the first source naming it winning:
 * 1. `materials[name].temporalAntialiasing`, by the material's exact name;
 * 2. `materials[name].responsive`: `true` the responsive share, `false` taking the material out of
 *    the responsive shortcuts below;
 * 3. `responsive` — a match on the objects, as one HLOD group names its objects: the materials of
 *    every object it matches, only those its `material` pattern names where it has one —: the
 *    responsive share;
 * 4. the material's own `extras.temporalAntialiasing` in the glTF (`TEMPORAL_AA_EXTRA`);
 * 5. its own `extras.responsive: true` (`RESPONSIVE_EXTRA`): the responsive share;
 * 6. 1.
 * A job naming none of them compiles as before. A value left out or `null` names nothing, as the
 * compiler reads it.
 */
import {
  DEFAULT_TEMPORAL_AA_LEVEL,
  MATERIAL_SETTINGS,
  MATERIALS_OPTION,
  RESPONSIVE_OPTION,
  TEMPORAL_AA_LEVELS,
  TEMPORAL_AA_OPTION,
  TEMPORAL_AA_SHARES,
  type HlodWireMatch,
  type MaterialSettingsWire,
  type TemporalAntialiasingLevel,
  type TemporalAntialiasingShareName,
} from './compilerAbi.ts'
import {
  fieldsOf,
  isRecord,
  refusal,
  wireMatch,
  type NameMatch,
  type NamePattern,
  type Refuse,
} from './nameMatch.ts'

/** The objects whose materials keep a responsive history: a node's name (a string, exact), a
 *  regular expression on it, or a match on what the glTF carries (`NameMatch`). */
export type ResponsiveOption = NamePattern | NameMatch

/** A material's history share: a name of `TEMPORAL_AA_SHARES` — `'normal'` (1), `'responsive'`
 *  (0.75), `'soft'` (0.5), `'off'` (0) — or a number in [0, 1]. */
export type TemporalAntialiasingShare = TemporalAntialiasingShareName | number

/** One material's settings: `temporalAntialiasing`, its history share; `responsive`, `true` the
 *  shortcut for the responsive share, `false` taking it out of the responsive match and extras. */
export type MaterialSettings = {
  temporalAntialiasing?: TemporalAntialiasingShare
  responsive?: boolean
}

/** The settings of materials, by their exact names in the glTF. */
export type MaterialsOption = Readonly<Record<string, MaterialSettings>>

/** The scene's temporal anti-aliasing: a quality level, `true` the default one, `false` off. */
export type TemporalAntialiasingOption = TemporalAntialiasingLevel | boolean

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
  if (option === true) return DEFAULT_TEMPORAL_AA_LEVEL
  if (option === false) return 'off'
  if (!(TEMPORAL_AA_LEVELS as readonly unknown[]).includes(option))
    refusal('temporalAntialiasing')(
      `must be one of ${TEMPORAL_AA_LEVELS.join(', ')}, true or false, got ${String(option)}`,
    )
  return option
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
 * A material's history share as a number: a name of `TEMPORAL_AA_SHARES`, or a number in [0, 1].
 * @param share - The share, by name or by value.
 * @param what - What names it, for the refusal.
 * @throws TypeError naming the names when it is neither.
 */
export function temporalAntialiasingShare(share: unknown, what = 'temporalAntialiasing'): number {
  if (typeof share === 'string' && Object.hasOwn(TEMPORAL_AA_SHARES, share))
    return TEMPORAL_AA_SHARES[share as TemporalAntialiasingShareName]
  if (typeof share === 'number' && share >= 0 && share <= 1) return share
  return refusal(what)(
    `must be a number from 0 to 1 or one of ${Object.keys(TEMPORAL_AA_SHARES).join(', ')}, got ${String(share)}`,
  )
}

/**
 * The responsive match the compiler reads for `option`: none when left out.
 * @param option - The objects, by name or by match, or none.
 * @returns The compiler's form (`HlodWireMatch`), `undefined` for none.
 * @throws TypeError naming what the host wrote wrong.
 */
export function resolveResponsive(option?: ResponsiveOption | null): HlodWireMatch | undefined {
  if (option === undefined || option === null) return undefined
  return wireMatch(option, 'responsive', refusal('responsive'))
}

/**
 * The material settings the compiler reads for `option`: none when left out; each entry holding
 * only `MATERIAL_SETTINGS`, its share as a number, `responsive` a boolean.
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
      if (fields.temporalAntialiasing != null)
        wire.temporalAntialiasing = temporalAntialiasingShare(
          fields.temporalAntialiasing,
          `${what}.temporalAntialiasing`,
        )
      if (fields.responsive != null) {
        if (typeof fields.responsive !== 'boolean')
          refuse(`${what}.responsive must be true or false`)
        wire.responsive = fields.responsive as boolean
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

/** A job's temporal anti-aliasing options as the compiler reads them, each left out when the job
 *  names none. */
export function materialJobFields({
  temporalAntialiasing,
  responsive,
  materials,
}: MaterialJobOptions) {
  const out: {
    temporalAntialiasing?: TemporalAntialiasingLevel
    responsive?: HlodWireMatch
    materials?: Record<string, MaterialSettingsWire>
  } = {}
  const level = resolveTemporalAntialiasing(temporalAntialiasing)
  const match = resolveResponsive(responsive)
  const settings = resolveMaterials(materials)
  if (level) out.temporalAntialiasing = level
  if (match) out.responsive = match
  if (settings) out.materials = settings
  return out
}

/** A job's temporal anti-aliasing options as the command line's flags, none when the job names
 *  none. */
export function materialFlags(options: MaterialJobOptions): string[] {
  const { temporalAntialiasing, responsive, materials } = materialJobFields(options)
  return [
    ...(temporalAntialiasing ? [`${TEMPORAL_AA_OPTION}${temporalAntialiasing}`] : []),
    ...(responsive ? [`${RESPONSIVE_OPTION}${JSON.stringify(responsive)}`] : []),
    ...(materials ? [`${MATERIALS_OPTION}${JSON.stringify(materials)}`] : []),
  ]
}
