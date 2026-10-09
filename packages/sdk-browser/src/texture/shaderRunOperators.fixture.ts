// The binary operators of WGSL on two scalars, which `shaderRun` (`shaderRun.fixture.ts`) applies
// component by component.

/** Each operator's result on two scalars, `u32` operators wrapped to 32 bits. */
export const SCALAR: Record<string, (a: number, b: number) => number | boolean> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
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
