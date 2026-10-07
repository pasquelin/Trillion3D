import assert from 'node:assert/strict'
import { test } from 'node:test'
import { math } from '../../../packages/sdk-core/src/world/math/index.ts'
import { HALTON_SWEEP, haltonSpan } from '../../../packages/math/src/sequence/sweep.fixture.ts'
import { mix } from './opening.ts'
import { matcapBall } from './painted.ts'
import { valueNoise } from './random.ts'

type Look = Parameters<typeof matcapBall>[1]

/** The kit's former list blend, its own `value + (b[i] − value) · t`. */
const oldMix = (a: readonly number[], b: readonly number[], t: number) =>
  a.map((value, i) => value + (b[i] - value) * t)

/** The math family as the painter read it before the engine's rules: lengths by `Math.hypot`, the
 *  blend by the kit's own `oldMix` formula. */
const oldMath = {
  ...math,
  lerp: (a: number, b: number, t: number) => oldMix([a], [b], t)[0],
  vector3: (x?: number, y?: number, z?: number) => {
    const v = math.vector3(x, y, z)
    // The silhouette reach, `(x, y, 0)`, was `Math.hypot(x, y)`; the lights' vectors have a z.
    const length = () => (v.z === 0 ? Math.hypot(v.x, v.y) : Math.hypot(v.x, v.y, v.z))
    return Object.assign(v, { length })
  },
}

/** What `matcapBall` paints with the family `family`, caught from a canvas stand-in. */
function paint(look: Look, family: typeof math) {
  let caught: Uint8ClampedArray = new Uint8ClampedArray(0)
  const context = {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (image: { data: Uint8ClampedArray }) => (caught = image.data),
  }
  const real = globalThis.document
  Object.assign(globalThis, {
    document: { createElement: () => ({ getContext: () => context }) },
  })
  try {
    matcapBall({ math: family, texture: { canvas: (c: unknown) => c } } as never, look)
  } finally {
    Object.assign(globalThis, { document: real })
  }
  return caught
}

// Proof (b), exhaustive: all 65536 pixels of each look, byte for byte, the painter run on the
// engine's family and on the former one. The lengths differ from `Math.hypot` in the last bit at
// most; the painted byte is a rounded product of them, so a difference shows only if one lands on
// a rounding tie, and none does.
test('the matcap bytes are those of the Math.hypot painter, on every pixel', () => {
  const looks: Required<Look>[] = [
    { base: [0.8, 0.2, 0.1], rim: [0, 0, 0], shine: 0, gloss: 20, metal: 0, wrap: 0 },
    { base: [0.9, 0.7, 0.3], rim: [0.1, 0.1, 0.2], shine: 0.6, gloss: 40, metal: 1, wrap: 0.3 },
    { base: [0.3, 0.6, 0.9], rim: [0.2, 0, 0], shine: 0.3, gloss: 8, metal: 0.5, wrap: 0.1 },
  ]
  for (const look of looks) assert.deepEqual(paint(look, math), paint(look, oldMath as typeof math))
})

test('valueNoise blends with math.lerp, the formula it wrote before', () => {
  const old = (a: number, b: number, t: number) => a + (b - a) * t
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const [a, b, t] = [haltonSpan(i, 2, -1, 1), haltonSpan(i, 3, -1, 1), haltonSpan(i, 5, 0, 1)]
    assert.ok(Object.is(math.lerp(a, b, t), old(a, b, t)))
  }
  const noise = valueNoise({ math })
  assert.ok(Math.abs(noise(0.3, 0.7, 0.2, 1)) <= 1)
})

test("the kit's mix blends by math.lerp, the formula it wrote before, number for number", () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const a = [2, 3, 5].map((base) => haltonSpan(i, base, -1e4, 1e4)),
      b = [7, 11, 13].map((base) => haltonSpan(i, base, -1e4, 1e4)),
      t = haltonSpan(i, 17, -0.5, 1.5)
    const now = mix({ math }, a, b, t),
      old = oldMix(a, b, t)
    for (let k = 0; k < 3; k++) assert.ok(Object.is(now[k], old[k]), `sweep ${i}`)
  }
})
