/**
 * The pieces the compile options' schema (`compilerOptionsSchema.ts`) builds its properties from,
 * each a plain object of the one key order the schema is published in (type, minimum, maximum,
 * description).
 */
import { settingTakes, type SettingRule } from '../contracts/settingRules.ts'
import type { JsonSchemaProperty } from './types.ts'

/** A switch. */
export const flag = (description: string): JsonSchemaProperty => ({ type: 'boolean', description })

/** A number of `type`, from `minimum` and up to `maximum` when it has them. */
const bounded = (
  type: 'number' | 'integer',
  description: string,
  minimum?: number,
  maximum?: number,
): JsonSchemaProperty => ({
  type,
  ...(minimum === undefined ? {} : { minimum }),
  ...(maximum === undefined ? {} : { maximum }),
  description,
})

/** A number, from `minimum` and up to `maximum` when it has them. */
export const num = (description: string, minimum?: number, maximum?: number) =>
  bounded('number', description, minimum, maximum)

/** A whole number, from `minimum` and up to `maximum` when it has them. */
export const int = (description: string, minimum?: number, maximum?: number) =>
  bounded('integer', description, minimum, maximum)

/** The setting `rule` (`SettingRule`, one without `above`) as a property: its kind, its range —
 *  the upper end left out where the rule has none —, `description` saying what it means. No
 *  `default` key: the description names it. */
export const ruleSchema = (rule: SettingRule, description: string): JsonSchemaProperty => {
  if (rule.kind === 'flag') return flag(description)
  if (rule.kind === 'choice') return { type: 'string', enum: [...rule.choices], description }
  if (rule.kind === 'vector')
    return {
      type: 'array',
      items: { type: 'number', description: 'One component.' },
      minItems: rule.default.length,
      maxItems: rule.default.length,
      description: `${description} Takes ${settingTakes(rule)}.`,
    }
  const [minimum, maximum] = rule.range
  return bounded(
    rule.kind === 'int' ? 'integer' : 'number',
    description,
    minimum,
    maximum < Number.MAX_SAFE_INTEGER ? maximum : undefined,
  )
}

/** A positive number: strictly above zero, as the compiler checks it. */
export const positive = (description: string): JsonSchemaProperty => ({
  type: 'number',
  description: `${description} Strictly positive.`,
})

/** A regular expression as the compiler reads it. */
const regex: JsonSchemaProperty = {
  type: 'object',
  description: 'A regular expression: its source, and its flags (i, m, s).',
  properties: {
    regex: { type: 'string', description: 'The source, as in /source/.' },
    flags: { type: 'string', description: 'The flags: i, m, s.' },
  },
  required: ['regex'],
}

/** A name to match: a string the exact name, `{ regex, flags }` a regular expression. */
const pattern = (what: string): JsonSchemaProperty => ({
  description: `${what}: a string is the exact name, { regex, flags } a regular expression.`,
  anyOf: [{ type: 'string', description: 'The exact name.' }, regex],
})

/** What a rule matches; every field named must match, and one naming none is refused. */
export const match: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  type: 'object',
  description: 'What the rule matches on the glTF; every field named must match, at least one.',
  properties: {
    node: pattern("The node's name"),
    mesh: pattern("Its mesh's name"),
    material: pattern("One of its primitives' material names"),
    extras: {
      type: 'object',
      description:
        "Values the node's extras must hold: { regex, flags } for a string, else the exact value.",
    },
  },
}))()

/** The objects a rule, a group or an option names: a node's exact name, a regular expression on
 *  it, or a match on what the glTF carries. */
export const nameOrMatch = (description: string): JsonSchemaProperty => ({
  description,
  anyOf: [{ type: 'string', description: "The node's exact name." }, regex, match],
})

/** A value that is one of `values`, or a switch: `named` says the first, `flagged` the second. */
export const choiceOrFlag = (
  description: string,
  values: readonly string[],
  named: string,
  flagged: string,
): JsonSchemaProperty => ({
  description,
  anyOf: [
    { type: 'string', enum: [...values], description: named },
    { type: 'boolean', description: flagged },
  ],
})

/** The fields of an option set for the whole scene and by object: its `settings`, and under
 *  `objects` the rules, in order, each `{ match, …settings }` setting them for `what` of the objects
 *  its match names (`meshBuild`, `objectSettings`). */
export const sceneAndRules = (
  settings: Record<string, JsonSchemaProperty>,
  objects: string,
  what: string,
): Record<string, JsonSchemaProperty> => ({
  ...settings,
  [objects]: {
    type: 'array',
    description: 'The rules by object, in order.',
    items: {
      type: 'object',
      description: `One rule: the objects it names and the settings it sets for ${what}.`,
      required: ['match'],
      properties: {
        match: nameOrMatch("The node's exact name, { regex, flags } on it, or a match object."),
        ...settings,
      },
    },
  },
})
