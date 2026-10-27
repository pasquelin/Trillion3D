// The binary operators of WGSL on two scalars, which `shaderRun` (`shaderRun.fixture.ts`) applies
// component by component.

/** The product of two scalars: a product of two 32-bit integers a double cannot hold exactly is taken
 *  modulo 2³², as the shader's integer wraps, so that a hash's multiplications keep their low bits. */
const product = (a: number, b: number) => {
  const exact = a * b
  if (Number.isSafeInteger(exact) || !Number.isInteger(a) || !Number.isInteger(b)) return exact
  if (Math.abs(a) >= 2 ** 32 || Math.abs(b) >= 2 ** 32) return exact
  return Number(BigInt.asUintN(32, BigInt(a) * BigInt(b)))
}

/** Each operator's result on two scalars, `u32` operators wrapped to 32 bits. */
export const SCALAR: Record<string, (a: number, b: number) => number | boolean> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': product,
  '/': (a, b) => a / b,
  '%': (a, b) => a % b,
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>>': (a, b) => a >>> b,
  '<<': (a, b) => (a << b) >>> 0,
  '&': (a, b) => (a & b) >>> 0,
  '|': (a, b) => (a | b) >>> 0,
  '^': (a, b) => (a ^ b) >>> 0,
}
