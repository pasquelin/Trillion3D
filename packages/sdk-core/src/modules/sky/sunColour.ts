import { temperatureFactor } from './blackBody.ts'

/**
 * The colour of a light's temperature: a light with `useTemperature` on has its colour multiplied
 * by the colour of a black body at `temperatureKelvin`, in the working space (linear sRGB, Rec. 709
 * primaries, D65 white). A light's own settings say whether it is on and at what kelvin (a scene
 * light: off, 6500 K, `../../scene/light/fields.ts`); the sky module's sun part (`./sunPart.ts`)
 * is the one table of the temperature's settings, which it turns on at 6500 K. The kelvin is
 * clamped where the colour is made (`temperatureFactor`), not refused.
 */

/** A light's temperature settings. */
export interface SunTemperatureSettings {
  readonly useTemperature: boolean
  readonly temperatureKelvin: number
}

type Vec3 = readonly [number, number, number]

/** A light's colour, with its temperature's factor multiplied in when `useTemperature` is on
 *  (the colour as it is otherwise). The intensity multiplies the result, not the factor. */
export function temperatureColour(
  colour: Vec3,
  { useTemperature, temperatureKelvin }: SunTemperatureSettings,
): Vec3 {
  if (!useTemperature) return colour
  const f = temperatureFactor(temperatureKelvin)
  return [colour[0] * f[0], colour[1] * f[1], colour[2] * f[2]]
}
