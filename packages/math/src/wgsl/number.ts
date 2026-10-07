import { FLOAT32_MAX } from '../constants.ts'

/**
 * A WGSL float literal naming the single-precision value nearest `value`, the one the processor
 * holds after `Math.fround`, so the shader and TypeScript read the same number to the bit. It is
 * written with the nine significant digits that name one `f32` and no other: a double printed with
 * more digits is not safer, one printed at twelve fell just under the midpoint of two neighbours
 * and parsed one ulp away. Two cases keep the exact value instead: the greatest `f32`, whose nine
 * digits round past it and make a device refuse the module (it reads a literal against the finite
 * range before rounding), and `-0`, whose sign nine digits drop. A number with no `f32` (NaN, an
 * infinity, a magnitude past the greatest) is refused: WGSL has no literal for it.
 */
export function wgslF32(value: number) {
  const single = Math.fround(value)
  if (!Number.isFinite(single)) throw new RangeError(`no f32 literal for ${value}`)
  if (Object.is(single, -0)) return '-0.00000000'
  let text = single.toPrecision(9)
  if (Math.abs(Number(text)) > FLOAT32_MAX) text = String(single)
  return text.includes('.') || text.includes('e') ? text : `${text}.0`
}
