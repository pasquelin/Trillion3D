/**
 * What a compile option names objects by on what the glTF already carries — a node's name, its
 * mesh's, one of its materials', values of its `extras` —, and the one reading that turns a
 * host's form into the compiler's (`HlodWirePattern`, `HlodMatchOf` in `hlodAbi.ts`): the HLOD
 * rules (`hlodOptions.ts`) and the responsive objects (`materialOptions.ts`) read it.
 */
import type { HlodMatchOf, HlodWireMatch, HlodWirePattern } from './hlodAbi.ts'

/** A name to match: a string the exact name, a regular expression any name it matches —
 *  `{ regex, flags }` its JSON form, for a command line's flag. */
export type NamePattern = HlodWirePattern | RegExp

/** What a match names on what the glTF already carries (`HlodMatchOf`). */
export type NameMatch = HlodMatchOf<NamePattern>

/** A refusal in an option's own words. */
export type Refuse = (message: string) => never

/** The refusal of option `option`, in the words the host wrote: a `TypeError` naming it. */
export const refusal =
  (option: string): Refuse =>
  (message: string): never => {
    throw new TypeError(`${option}: ${message}`)
  }

/** Whether `value` is a plain object: not null, not an array. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The fields a match may hold. */
const MATCH_FIELDS = ['node', 'mesh', 'material', 'extras'] as const

/** `value` as an object holding only `fields`, refused otherwise, `what` naming it. */
export function fieldsOf(
  value: unknown,
  fields: readonly string[],
  what: string,
  refuse: Refuse,
): Record<string, unknown> {
  if (!isRecord(value)) return refuse(`${what} must be an object of ${fields.join(', ')}`)
  const unknown = Object.keys(value).find((key) => !fields.includes(key))
  if (unknown !== undefined) refuse(`${what} has no field ${unknown}: ${fields.join(', ')}`)
  return value as Record<string, unknown>
}

/** Whether `value` is a pattern: a name, a regular expression or its JSON form. */
const isPattern = (value: unknown): value is NamePattern =>
  typeof value === 'string' ||
  value instanceof RegExp ||
  (isRecord(value) && typeof value.regex === 'string')

/** The flags the compiler honours as a regular expression of this runtime does: `i`, `m`, `s`,
 *  and `g`, `u`, `y`, which mean nothing to a single test. */
const PATTERN_FLAGS = 'imsguy'

/** A pattern as the compiler reads it. A regular expression the compiler would read otherwise is
 *  refused: a flag it does not know (`d`, `v`), or `i` on a source holding a letter past ASCII,
 *  which its case folding does not reach. */
function wirePattern(pattern: unknown, what: string, refuse: Refuse): HlodWirePattern {
  const wire = pattern instanceof RegExp ? { regex: pattern.source, flags: pattern.flags } : pattern
  if (!isPattern(wire) || wire instanceof RegExp)
    return refuse(`${what} must be a name or a regular expression`)
  if (typeof wire === 'string') return wire
  const flags = wire.flags ?? ''
  const unknown = [...flags].find((flag) => !PATTERN_FLAGS.includes(flag))
  if (unknown !== undefined)
    refuse(`${what}: flag ${unknown} is not supported (${[...PATTERN_FLAGS].join(', ')})`)
  if (flags.includes('i') && [...wire.regex].some((c) => c.charCodeAt(0) > 0x7f))
    refuse(`${what}: flag i folds ASCII letters only; write both cases in /${wire.regex}/`)
  return wire
}

/**
 * An option set for the whole scene and by object, as the compiler reads it (`meshBuild`,
 * `objectSettings`): its settings `settingNames`, which `settingsOf` reads from the fields `named`
 * — `what` naming them in a refusal —, and under `objects` the rules `{ match, …settings }`, in
 * order, each setting them for the objects its match names.
 * @throws TypeError naming the option `field` and what it holds wrong.
 */
export function resolveByObject<S extends object>(
  option: unknown,
  field: string,
  settingNames: readonly string[],
  objects: string,
  settingsOf: (named: Record<string, unknown>, what: string, refuse: Refuse) => S,
) {
  const refuse: Refuse = refusal(field)
  const named = fieldsOf(option, [...settingNames, objects], 'the settings', refuse)
  const wire = settingsOf(named, '', refuse) as S & {
    objects?: (S & { match: HlodWireMatch })[]
  }
  const rules = named[objects]
  if (rules === undefined || rules === null) return wire
  if (!Array.isArray(rules)) return refuse(`${objects} must be an array of rules`)
  wire.objects = rules.map((rule: unknown, at) => {
    const what = `${objects}[${at}]`
    const fields = fieldsOf(rule, [...settingNames, 'match'], what, refuse)
    return {
      match: wireMatch(fields.match, `${what}.match`, refuse),
      ...settingsOf(fields, `${what}.`, refuse),
    }
  })
  return wire
}

/**
 * A compile option a job names as one value the compiler reads as JSON, under the job field
 * `field` and the command line's flag `flag`: `resolve` reads it, `undefined` for none.
 * `fields` is the job's field as the compiler reads it, left out when the job names none; `flags`
 * the command line's flag, none likewise.
 */
export function jsonJobOption<K extends string, O, W>(
  field: K,
  flag: string,
  resolve: (option?: O | null) => W | undefined,
) {
  return {
    fields(job: { [F in K]?: O | null }) {
      const wire = resolve(job[field])
      return (wire === undefined ? {} : { [field]: wire }) as { [F in K]?: W }
    },
    flags(job: { [F in K]?: O | null }): string[] {
      const wire = resolve(job[field])
      return wire === undefined ? [] : [`${flag}${JSON.stringify(wire)}`]
    },
  }
}

/** The resolver of the option `name` that is a match on objects: `undefined` for none, else the
 *  match as the compiler reads it (`wireMatch`). */
export const matchResolver =
  <O>(name: string) =>
  (option?: O | null): HlodWireMatch | undefined =>
    option === undefined || option === null ? undefined : wireMatch(option, name, refusal(name))

/** A match as the compiler reads it: a pattern is a node's name; an object holds only the match's
 *  fields — the compiler refuses one naming none. */
export function wireMatch(match: unknown, what: string, refuse: Refuse): HlodWireMatch {
  if (isPattern(match)) return { node: wirePattern(match, what, refuse) }
  const fields = fieldsOf(match, MATCH_FIELDS, what, refuse)
  const out: HlodWireMatch = {}
  for (const key of ['node', 'mesh', 'material'] as const)
    if (fields[key] != null) out[key] = wirePattern(fields[key], `${what}.${key}`, refuse)
  const extras = fields.extras
  if (extras !== undefined && extras !== null) {
    if (!isRecord(extras)) refuse(`${what}.extras must be an object`)
    out.extras = Object.fromEntries(
      Object.entries(extras).map(([key, value]) => [
        key,
        isPattern(value)
          ? wirePattern(value, `${what}.extras.${key}`, refuse)
          : (value as number | boolean | null),
      ]),
    )
  }
  return out
}
