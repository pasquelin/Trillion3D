import type { SceneLight } from '../../scene/light/contracts.ts'
import { DEFAULT_TEMPERATURE_KELVIN } from '../../scene/light/fields.ts'
import { Color } from '../math/color.ts'
import { listen } from '../observed.ts'
import type { Light } from './light.ts'
import { lightChanged } from './lightNumbers.ts'

/** The settings of a light that touch the air and its colour, held aside the light's own numbers:
 *  the yes/no settings (`LIGHT_SWITCHES`) and the tint of a sun's disk (`tintOf`). The yes/no
 *  settings of a light that are off by default: whether its colour follows a
 *  temperature (`SceneLight.useTemperature`), whether its shadow shades the air
 *  (`shadowsAir`) and whether the air's transmittance toward it is read per surface point
 *  (`transmittancePerPixel`) and whether it shines through the subsurface-profile surfaces it
 *  shadows (`transmission`). */
const LIGHT_SWITCHES = [
  'useTemperature',
  'shadowsAir',
  'transmittancePerPixel',
  'transmission',
] as const
/** The name of one of the switches. */
export type LightSwitch = (typeof LIGHT_SWITCHES)[number]

/** The lights each switch is on for: few, so a set each and not a field every light would carry. */
const ON: Record<LightSwitch, WeakSet<Light>> = {
  useTemperature: new WeakSet(),
  shadowsAir: new WeakSet(),
  transmittancePerPixel: new WeakSet(),
  transmission: new WeakSet(),
}

/** Turns the switches `p` names on for `light`; the others stay off. */
export function takeSwitches(light: Light, p: Partial<Record<LightSwitch, boolean>>) {
  for (const name of LIGHT_SWITCHES) if (p[name]) ON[name].add(light)
}

/** Gives `light` the switches `source` has. */
export function copySwitches(light: Light, source: Light) {
  for (const name of LIGHT_SWITCHES) {
    if (ON[name].has(source)) ON[name].add(light)
    else ON[name].delete(light)
  }
}

/** Defines the switches as accessors of `proto`: a write is noted on the light and reaches the
 *  world at once. */
export function defineSwitches(proto: Light) {
  for (const name of LIGHT_SWITCHES)
    Object.defineProperty(proto, name, {
      get(this: Light) {
        return ON[name].has(this)
      },
      set(this: Light, value: boolean) {
        if (value) ON[name].add(this)
        else ON[name].delete(this)
        lightChanged(this)
      },
    })
}

/** The tint of each light's sun disk that was read or written: few, so a map and not a colour
 *  every light would carry. */
const TINTS = new WeakMap<Light, Color>()

/** The colour `light`'s sun disk is multiplied by, white until set: change it in place with
 *  `set`; a write is noted on the light and reaches the world at once. */
export function tintOf(light: Light) {
  let tint = TINTS.get(light)
  if (!tint) {
    tint = new Color([1, 1, 1])
    TINTS.set(light, tint)
    listen(tint, () => lightChanged(light))
  }
  return tint
}

/** The tint of `light`'s sun disk when it was set to something but white; none otherwise. */
export function tintSet(light: Light) {
  const tint = TINTS.get(light)
  return tint && !(tint.r === 1 && tint.g === 1 && tint.b === 1) ? tint : undefined
}

/** Gives `light` the tint `value` names (a colour input); white, none held, for none. */
export function takeTint(light: Light, value: ConstructorParameters<typeof Color>[0]) {
  if (value !== undefined) tintOf(light).set(value)
}

/** Gives `light` the tint `source` has. */
export function copyTint(light: Light, source: Light) {
  const tint = tintSet(source)
  if (tint) tintOf(light).copy(tint)
  else if (TINTS.has(light)) tintOf(light).set([1, 1, 1])
}

/** Writes into `record` what `light` sets of its colour's temperature and, a directional light, of
 *  the air (the shade on it, the transmittance per surface point, the sun disk's tint), each only
 *  where it is not the default: a light that names none keeps the record it had. */
export function recordColourAndAir(light: Light, record: SceneLight) {
  if (light.useTemperature) record.useTemperature = true
  if (light.transmission) record.transmission = true
  if (light.temperatureKelvin !== DEFAULT_TEMPERATURE_KELVIN)
    record.temperatureKelvin = light.temperatureKelvin
  if (record.kind !== 'directional') return
  if (light.shadowsAir) record.shadowsAir = true
  if (light.transmittancePerPixel) record.transmittancePerPixel = true
  const tint = tintSet(light)
  if (tint) record.sunDiskTint = tint.toArray()
}
