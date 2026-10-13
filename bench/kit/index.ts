/**
 * The bench's page kit, served to a page the bench plays as `../runtime/kit.js`: what a scene page
 * needs beside the engine and nothing drawn. A seeded sequence, so every run builds the same
 * scene, and its settings read at their declared start, the bench never touching a panel.
 */
export { lcgRandom } from '../../packages/math/src/sequence/random.ts'

/** A setting as a page declares it, its kind read from the value: `[min, max, value]` or
 *  `[min, max, value, step]` a slider, `'#rrggbb'` a colour, any other text a line of help,
 *  `true`/`false` a toggle, `['a', 'b', …]` a choice starting on its first option, a function a
 *  button. */
export type ControlSpec =
  | readonly [number, number, number]
  | readonly [number, number, number, number]
  | string
  | boolean
  | readonly string[]
  | (() => void)

/** The value a declared setting starts at: a button has none, a line of help none. */
type ControlValue<Spec> = Spec extends readonly number[]
  ? number
  : Spec extends readonly string[]
    ? string
    : Spec extends boolean
      ? boolean
      : Spec extends `#${string}`
        ? string
        : never

export type ControlValues<Specs> = {
  -readonly [
    Key in keyof Specs as [ControlValue<Specs[Key]>] extends [never] ? never : Key
  ]: ControlValue<Specs[Key]>
}

/** The value `spec` starts at, `undefined` for a button or a line of help. */
function startValue(spec: ControlSpec): number | string | boolean | undefined {
  if (typeof spec === 'function') return undefined
  if (typeof spec === 'boolean') return spec
  if (typeof spec === 'string') return spec.startsWith('#') ? spec.toLowerCase() : undefined
  return typeof spec[0] === 'number' ? (spec[2] as number) : spec[0]
}

/**
 * The page's settings at their declared start: `onChange(values)` runs once, with no key, as a
 * page's panel runs it at start, and the values are returned. A world handed in its place is
 * ignored: the bench draws no counters over the scene.
 */
export function controls<const Specs extends Record<string, ControlSpec>>(
  specs: Specs,
  onChange?: ((values: ControlValues<Specs>, key?: keyof ControlValues<Specs>) => void) | object,
): ControlValues<Specs> {
  const values: Record<string, number | string | boolean> = {}
  for (const [key, spec] of Object.entries(specs)) {
    const value = startValue(spec)
    if (value !== undefined) values[key] = value
  }
  const live = values as ControlValues<Specs>
  if (typeof onChange === 'function') onChange(live)
  return live
}
