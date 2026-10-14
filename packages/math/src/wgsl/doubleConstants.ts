/**
 * The emulated doubles' common constants (`double.ts`'s two words, `wgslDouble`), one declaration
 * each: the CPU's numbers to the bit.
 */
import { wgslConst } from './decl.ts'
import { wgslDouble } from './number.ts'

const doubleConst = (name: string, value: number) =>
  wgslConst(name, [], `const ${name}=${wgslDouble(value)};`)

export const D_ZERO = doubleConst('D_ZERO', 0)
export const D_ONE = doubleConst('D_ONE', 1)
export const D_HALF = doubleConst('D_HALF', 0.5)
export const D_TWO = doubleConst('D_TWO', 2)
export const D_INFINITY = doubleConst('D_INFINITY', Infinity)
export const D_NEG_INFINITY = doubleConst('D_NEG_INFINITY', -Infinity)
