import { wgslFn } from '../../../math/src/wgsl/decl.ts'

/**
 * A colour whose value is not a number written as the reference's unsigned targets write it: a
 * not-a-number is 0, a minus infinity 0, a plus infinity 1, every finite value as it is
 * (`finiteValue`) — a black light's logarithm, a grade number of 0 that divides, a colour past what
 * a curve defines. The test is on the value's bits, which a compiler's assumption of finite
 * numbers cannot remove. The display value of the curves read without the table gives it
 * (`displayValue`), `storable` the table's texels: held from 0 to 1, as the table stores them —
 * the table is read trilinearly, so one texel of NaN would poison the cell around it.
 */
export const FINITE_VALUE_WGSL = wgslFn(
  'finiteValue',
  [],
  `fn finiteValue(value:vec3f)->vec3f{
 let bits=bitcast<vec3u>(value);
 let special=(bits&vec3u(2139095040u))==vec3u(2139095040u);
 let infinite=bits==vec3u(2139095040u);
 return select(value,select(vec3f(0.0),vec3f(1.0),infinite),special);
}`,
)

/** A value of a texel of the table: held from 0 to 1, a value that is not a number written 0 (`finiteValue`). */
export const STORABLE_WGSL = wgslFn(
  'storable',
  [FINITE_VALUE_WGSL],
  'fn storable(value:vec3f)->vec3f{return saturate(finiteValue(value));}',
)
