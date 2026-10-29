import { noteNodeWrite } from '../../scene/core/nodeEdits.ts'
import { LIGHT_SETTINGS, type SceneLight } from '../../scene/light/contracts.ts'
import {
  DEFAULT_INNER_CONE_ANGLE,
  DEFAULT_OUTER_CONE_ANGLE,
  DEFAULT_TEMPERATURE_KELVIN,
  defaultIntensityOf,
} from '../../scene/light/fields.ts'
import { LOCAL_NUMBERS } from '../../scene/light/validateLamp.ts'
import { resolveSetting, resolveSettings, type SettingRules } from '../../contracts/settingRules.ts'
import { listen, type Observed } from '../observed.ts'
import type { Light } from './light.ts'
import type { LightParameters } from './lightParameters.ts'

/** The numbers a light carries, each a property whose write reaches the world at once. */
export const NUMBERS = [
  'intensity',
  'distance',
  'decay',
  'innerConeAngle',
  'outerConeAngle',
  'width',
  'height',
  'radius',
  'tubeLength',
  'softRadius',
  'angularRadius',
  'softAngle',
  'hairDeepShadowLayerDistribution',
  'fogScattering',
  'shadowResolutionScale',
  'temperatureKelvin',
  'forwardShadingPriority',
  'radialExponent',
  'diffuseShare',
  'specularShare',
  ...LOCAL_NUMBERS,
] as const
export type LightNumber = (typeof NUMBERS)[number]

/** The kinds of a light the store holds, by the core kind they are: the rest have no unit. */
const STORE_KINDS: Record<string, SceneLight['kind']> = {
  point: 'point',
  spot: 'spot',
  directional: 'directional',
  rectArea: 'rect',
}

/** The store's kind of a light of core `kind`, none for a kind the store does not hold. */
export const storeKindOf = (kind: string): SceneLight['kind'] | undefined => STORE_KINDS[kind]

/** A rectangle light's side, in metres, when it names none: 64 cm. */
const RECT_SIDE = 0.64

/** The intensity a light of `kind` starts with where `p` names none: the store's default for its
 *  kind, unit and shape (`defaultIntensityOf`), 1 for a kind the store does not hold. */
function initialIntensity(kind: string, p: LightParameters) {
  const stored = storeKindOf(kind)
  if (!stored) return 1
  return defaultIntensityOf({
    kind: stored,
    intensityUnits: p.intensityUnits,
    outerConeAngle: p.outerConeAngle,
    innerConeAngle: p.innerConeAngle,
    inverseSquared: p.inverseSquared,
    emitterRadius: p.radius,
    emitterLength: p.tubeLength,
    size: [p.width ?? RECT_SIDE, p.height ?? RECT_SIDE],
  })
}

/** The default of each number a light starts with but its intensity, whatever the parameters name: how far it reaches and the cone of a
 *  spot, the shape of its source (a sun's angular radius the setting's, the other kinds' 0), and how it is lit, shadowed and
 *  weighed. The one table of them; a number of `LightNumber` left out of it is refused by the type. */
const NUMBER_DEFAULTS: Record<Exclude<LightNumber, 'intensity'>, (kind: string) => number> = {
  distance: () => 0,
  decay: () => 2,
  innerConeAngle: () => DEFAULT_INNER_CONE_ANGLE,
  outerConeAngle: () => DEFAULT_OUTER_CONE_ANGLE,
  width: () => RECT_SIDE,
  height: () => RECT_SIDE,
  radius: () => 0,
  tubeLength: () => 0,
  softRadius: () => 0,
  angularRadius: (kind) => (kind === 'directional' ? LIGHT_SETTINGS.sunAngularRadius : 0),
  softAngle: () => 0,
  hairDeepShadowLayerDistribution: () => 0.5,
  fogScattering: () => 1,
  shadowResolutionScale: () => 1,
  temperatureKelvin: () => DEFAULT_TEMPERATURE_KELVIN,
  forwardShadingPriority: () => 0,
  radialExponent: () => LIGHT_SETTINGS.radialExponent,
  diffuseShare: () => 1,
  specularShare: () => 1,
  inverseExposureBlend: () => 0,
  maxDrawDistance: () => 0,
}

/** The numbers a light of `kind` starts with: the parameters' or the defaults. */
export function initialNumbers(kind: string, p: LightParameters): Record<LightNumber, number> {
  const numbers = { intensity: p.intensity ?? initialIntensity(kind, p) } as Record<
    LightNumber,
    number
  >
  for (const name of Object.keys(NUMBER_DEFAULTS) as (keyof typeof NUMBER_DEFAULTS)[])
    numbers[name] = p[name] ?? NUMBER_DEFAULTS[name](kind)
  return numbers
}

/** A write to one of `light`'s settings: noted on the light, and told to the world. */
export function lightChanged(light: Light) {
  noteNodeWrite(light)
  light._link?.content(light)
}

/** Defines each of `names` as an accessor of `proto` over the values `valuesOf` gives for a light:
 *  a write is noted on the light and reaches the world at once. */
export function defineWritable<Name extends string, Value>(
  proto: Light,
  names: readonly Name[],
  valuesOf: (light: Light) => Record<Name, Value>,
) {
  for (const name of names)
    Object.defineProperty(proto, name, {
      get(this: Light) {
        return valuesOf(this)[name]
      },
      set(this: Light, value: Value) {
        valuesOf(this)[name] = value
        lightChanged(this)
      },
    })
}

/** Defines each key of `getters` as a read-only property of `proto`, the value its getter gives for
 *  a light. */
export function defineReadonly(proto: Light, getters: Record<string, (light: Light) => unknown>) {
  for (const [name, getter] of Object.entries(getters))
    Object.defineProperty(proto, name, {
      get(this: Light) {
        return getter(this)
      },
    })
}

/** A number or a flag a light setting holds (`ruledLightSettings` also holds the name of a choice, as the rule gives it). */
type Scalar = number | boolean

/**
 * A group of light settings that are plain numbers and flags, `names` each at its default in
 * `defaults`: the values a light holds (`fresh`), the ones a page names written into them (`take`),
 * the ones that differ from their default (`differing`) and the ones a record holds
 * (`fromRecord`), by field.
 */
export function scalarGroup<Name extends string>(
  names: readonly Name[],
  defaults: Readonly<Record<Name, Scalar>>,
) {
  return {
    /** The values of a light that sets none. */
    fresh: () =>
      Object.fromEntries(names.map((name) => [name, defaults[name]])) as Record<Name, Scalar>,
    /** Writes into `values` each setting `parameters` names. */
    take(values: Record<Name, Scalar>, parameters: object) {
      const named = parameters as Record<string, Scalar | undefined>
      for (const name of names) {
        const value = named[name]
        if (value !== undefined) values[name] = value
      }
    },
    /** The values that differ from their default, but those `skip` names. */
    differing(values: Record<Name, Scalar>, skip?: (name: Name) => boolean) {
      const out: Record<string, Scalar> = {}
      for (const name of names)
        if (values[name] !== defaults[name] && !skip?.(name)) out[name] = values[name]
      return out
    },
    /** The settings of `record`, undefined where it holds none. */
    fromRecord(record: SceneLight): Record<string, Scalar | undefined> {
      const from = record as unknown as Record<string, Scalar | undefined>
      return Object.fromEntries(names.map((name) => [name, from[name]]))
    },
  }
}

/**
 * What a group of settings holds for the lights that set any: few lights do, so a map and not
 * fields each light would carry. A light's state is made (`make`) at its first use (`of`); a write
 * to one of the `observed` values it holds reaches the world as a write to the light.
 */
export function lightStates<State>(
  make: () => State,
  observed: (state: State) => readonly Observed[],
) {
  const states = new WeakMap<Light, State>()
  return {
    /** The state of `light`, none for a light that never used one. */
    peek: (light: Light) => states.get(light),
    /** The state of `light`, made at its first use. */
    of: (light: Light) => {
      let state = states.get(light)
      if (!state) {
        state = make()
        states.set(light, state)
        for (const value of observed(state)) listen(value, () => lightChanged(light))
      }
      return state
    },
  }
}

/**
 * The light settings that are numbers and flags a group of rules names (`LIGHT_SHADOW_RULES`,
 * `LIGHT_CONTACT_SHADOW_RULES`), each checked by its rule: `take` what a page names (for the lights `only`
 * accepts), `copy` a light's, `settingsSet` those that differ from their default, `fromRecord` those a
 * record holds, `define` the properties of `proto`, whose writes the rules check and the world hears at
 * once. `Parameters` is what a page may pass.
 */
export function ruledLightSettings<Parameters extends object>(
  rules: SettingRules,
  only: (light: Light) => boolean = () => true,
) {
  const names = Object.keys(rules)
  const defaults = Object.freeze(resolveSettings(rules, {})) as Record<string, Scalar>
  const group = scalarGroup(names, defaults)
  const states = lightStates<Record<string, Scalar>>(group.fresh, () => [])
  return {
    take(light: Light, p: Parameters) {
      if (!only(light)) return
      const named = p as Record<string, Scalar | null | undefined>
      for (const name of names)
        if (named[name] !== undefined)
          states.of(light)[name] = resolveSetting(rules[name], named[name] as never) as Scalar
    },
    copy(light: Light, source: Light) {
      const from = states.peek(source)
      const to = from ? states.of(light) : states.peek(light)
      if (to) Object.assign(to, from ?? group.fresh())
    },
    settingsSet(light: Light): Parameters {
      const values = states.peek(light)
      return (values && only(light) ? group.differing(values) : {}) as Parameters
    },
    fromRecord: (record: SceneLight) => group.fromRecord(record) as Parameters,
    define(proto: Light) {
      for (const [name, rule] of Object.entries(rules))
        Object.defineProperty(proto, name, {
          get(this: Light) {
            return states.of(this)[name]
          },
          set(this: Light, value: Scalar) {
            states.of(this)[name] = resolveSetting(rule, value as never) as Scalar
            lightChanged(this)
          },
        })
    },
  }
}
