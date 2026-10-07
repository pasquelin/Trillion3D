import test from 'node:test'
import assert from 'node:assert/strict'
import { hypot2, hypot3, hypot4 } from './hypot.ts'

// The helpers must return `Math.hypot`'s value to the bit under V8, the engine whose builtin they
// port: signed zeros told apart, every NaN equal to every NaN.
const same = (a: number, b: number) => Object.is(a, b) || (a !== a && b !== b)
const EDGE = [
  0,
  -0,
  1,
  -1,
  3,
  4,
  12,
  Infinity,
  -Infinity,
  NaN,
  5e-324,
  -5e-324,
  2.2250738585072014e-308,
  1.7976931348623157e308,
  -1.7976931348623157e308,
  1e-160,
  1e160,
  0.1,
  1 + 2 ** -52,
]

test('hypot2, hypot3 and hypot4 equal Math.hypot on every edge-case pair, triple and quadruple', () => {
  for (const x of EDGE)
    for (const y of EDGE) {
      assert.ok(same(hypot2(x, y), Math.hypot(x, y)), `${x} ${y}`)
      for (const z of EDGE) {
        assert.ok(same(hypot3(x, y, z), Math.hypot(x, y, z)), `${x} ${y} ${z}`)
        for (const w of EDGE)
          if (!same(hypot4(x, y, z, w), Math.hypot(x, y, z, w))) assert.fail(`${x} ${y} ${z} ${w}`)
      }
    }
})

test('hypot2, hypot3 and hypot4 equal Math.hypot on 10^6 random inputs of every magnitude and bit pattern', () => {
  let s = 12345
  const next = () => ((s ^= s << 13), (s ^= s >>> 17), (s ^= s << 5), (s >>> 0) / 4294967296)
  const f64 = new Float64Array(1),
    u32 = new Uint32Array(f64.buffer)
  // Kind 0: close magnitudes, where the Kahan compensation matters; 1: every scale; 2: raw bits.
  const pick = (kind: number) => {
    if (kind === 0) return (next() - 0.5) * 20
    if (kind === 1) return (next() - 0.5) * 10 ** (Math.floor(next() * 40) - 20)
    u32[0] = (next() * 2 ** 32) >>> 0
    u32[1] = (next() * 2 ** 32) >>> 0
    return f64[0]
  }
  for (let i = 0; i < 1e6; i++) {
    const x = pick(i % 3),
      y = pick((i >> 2) % 3),
      z = pick((i >> 4) % 3),
      w = pick((i >> 6) % 3)
    if (!same(hypot2(x, y), Math.hypot(x, y))) assert.fail(`${x} ${y}`)
    if (!same(hypot3(x, y, z), Math.hypot(x, y, z))) assert.fail(`${x} ${y} ${z}`)
    if (!same(hypot4(x, y, z, w), Math.hypot(x, y, z, w))) assert.fail(`${x} ${y} ${z} ${w}`)
  }
})
