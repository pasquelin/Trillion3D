// The filtered read's tap weights (`vsmFilterTaps`) are the tent max(0, 1 − |q − k|) written with
// its two differences, not floor and fraction compared per column: q − (k − 1) is the exact
// fraction on the upper column, (k + 1) − q rounds the same real 1 − f once on the lower, every
// other column clamps to +0. Run in f32 over every f32 coordinate a stride apart.
import test from 'node:test'
import assert from 'node:assert/strict'
import { directShadowWgsl } from './shadowWgsl.ts'
import { saturate } from '../../../../math/src/scalar/reals.ts'

const SOURCE = directShadowWgsl(null, 18)

test("the tent weights are develop's floor-and-fraction weights, bit for bit in f32", () => {
  // The shipped form, its columns read from the text; the floor-and-fraction form, in f32.
  const shipped = /let below=vec4f\(([^)]*)\);let above=vec4f\(([^)]*)\);/.exec(SOURCE)!
  assert.match(SOURCE, /let wx=saturate\(min\(q\.x-below,above-q\.x\)\);/)
  const [below, above] = [shipped[1], shipped[2]].map((v) => v.split(',').map(Number))
  const f = Math.fround
  const tent = (q: number) => below.map((b, k) => saturate(Math.min(f(q - b), f(above[k] - q))))
  const develop = (q: number) => {
    const c = Math.floor(q),
      fr = f(q - c)
    return [0, 1, 2, 3].map((k) => (k === c ? f(1 - fr) : 0) + (k === c + 1 ? fr : 0))
  }
  // Every f32 of [0, 4) a stride apart — a tap's coordinate lies in (0, 3): a base in [1, 2), a
  // tap within a texel —, and each column's weight compared by its bits.
  const word = new Float32Array(1),
    bits = new Uint32Array(word.buffer)
  let checked = 0
  for (let b = 0; ; b += 251) {
    bits[0] = b
    const q = word[0]
    if (q >= 4) break
    const [a, d] = [tent(q), develop(q)]
    for (let k = 0; k < 4; k++)
      if (!Object.is(a[k], d[k])) assert.fail(`q ${q} column ${k}: ${a[k]} against ${d[k]}`)
    checked++
  }
  assert.ok(checked > 4.3e6, `${checked} coordinates`)
})
