import { EngineError } from '../../contracts/cache.ts'
import {
  ruleFields,
  sameValue,
  type SettingRules,
  type SettingValue,
} from '../../contracts/settingRules.ts'
import type { SceneLight } from './contracts.ts'

const shared = /* @__PURE__ */ new WeakMap<object, object>()
/** What a group's `resolve` gives for `given`; for none of its fields, the defaults, made once and frozen with the
 *  vectors they hold: the one object every light that names none shares. */
function resolveShared<V extends object>(
  resolve: (given: Record<string, unknown>) => V,
  given: Record<string, unknown>,
) {
  if (Object.keys(given).length) return resolve(given)
  let defaults = shared.get(resolve) as Readonly<V> | undefined
  if (!defaults) {
    const made = resolve({})
    for (const value of Object.values(made)) if (Array.isArray(value)) Object.freeze(value)
    shared.set(resolve, (defaults = Object.freeze(made)))
  }
  return defaults as V
}

/**
 * A GROUP OF LIGHT FIELDS NAMED, TYPED AND DEFAULTED BY SETTING RULES (cloud shadows, light shafts,
 * contact shadows): the one way such a group is validated into a record, read from a held record and
 * compared.
 * `rules` is the group's rules by field, `resolve` their resolver (a `TypeError` for a field or a
 * value a rule does not take), `directionalOnly` the fields only a directional light may hold, all
 * of the group's by default.
 */
export function ruledLightFields<V extends object>(
  rules: SettingRules,
  resolve: (given: Record<string, unknown>) => V,
  directionalOnly?: readonly string[],
) {
  const fields = ruleFields(rules) as readonly (keyof V & string)[]
  const givenOf = (light: SceneLight) => {
    const from = light as unknown as Record<string, unknown>,
      given: Record<string, unknown> = {}
    for (const field of fields) if (from[field] !== undefined) given[field] = from[field]
    return given
  }
  const held = new WeakMap<SceneLight, V>()

  /** The group's fields of `light` into `validated`, each as its rule takes it, the directional
   *  ones refused on a light that is not a directional one. */
  function validate(light: SceneLight, validated: SceneLight) {
    const given = givenOf(light)
    if (light.kind !== 'directional') {
      const field = (directionalOnly ?? fields).find((name) => given[name] !== undefined)
      if (field !== undefined)
        throw new EngineError(
          'INVALID_SCENE_LIGHT',
          `${light.id}: ${field} expects a directional light: it exists only for one`,
          given,
        )
    }
    if (!Object.keys(given).length) return
    let resolved: V
    try {
      resolved = resolve(given)
    } catch (error) {
      throw new EngineError(
        'INVALID_SCENE_LIGHT',
        `${light.id}: ${(error as Error).message}`,
        given,
      )
    }
    const into = validated as unknown as Record<string, unknown>
    for (const field of Object.keys(given)) {
      const value = resolved[field as keyof V]
      into[field] = Array.isArray(value) ? [...value] : value
    }
  }

  /** The group's settings of a held record, each its default where the record names none. The
   *  record is the store's own, replaced at every change: the answer is made once for it. */
  function of(light: SceneLight): V {
    let settings = held.get(light)
    if (!settings) held.set(light, (settings = resolveShared(resolve, givenOf(light))))
    return settings
  }

  /** Whether two lights ask the same of the group. */
  function same(a: SceneLight, b: SceneLight) {
    const x = of(a),
      y = of(b)
    return fields.every((field) => sameValue(x[field] as SettingValue, y[field] as SettingValue))
  }

  return { validate, of, same }
}
