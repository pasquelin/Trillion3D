// The composition the GPU runs for a linked placement (`gpuComposeWgsl.ts`) gives the CPU's words
// to the bit: the transform tree's double product (`multiplyMatrix4`), rounded as a `Float32Array`
// stores it, the translation brought to the eye by the double subtraction first
// (`worldToRenderOrigin`). Generated hierarchies: rotations, uneven and negative scales, shears,
// translations far from the origin, an eye far from it too.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { random } from '../page/cut/cutRuleChecks.fixture.ts'
import { multiplyMatrix4, worldToRenderOrigin } from '../../../sdk-core/src/index.ts'
import { COMPOSE_ROWS_WGSL } from './gpuComposeWgsl.ts'
import {
  DOUBLE_HELPERS,
  countLeadingZeros,
  generated,
  pair,
  type Pair,
} from './composeDoubles.fixture.ts'
import { FLOAT32_MAX } from '../../../math/src/constants.ts'

/** The parent's and the local matrix's doubles the shipped `composed` reads, one case at a time. */
const parents: Pair[] = [],
  locals: Pair[] = []
const run = shaderRun<{
  toF32(a: Pair): number
  dSub(a: Pair, b: Pair): Pair
  composed(parentAt: number, localAt: number, k: number): Pair
}>(COMPOSE_ROWS_WGSL, [...DOUBLE_HELPERS, 'toF32', 'composed'], {
  countLeadingZeros,
  parents,
  locals,
})

const f32Bits = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0]

test('a double rounds to single precision as a Float32Array stores it', () => {
  const next = random(3)
  const values = [0, -0, 1, -1, FLOAT32_MAX, 3.4028235677973366e38, 3.5e38, 1e-38]
  values.push(1.1754943508222875e-38, 1.401298464324817e-45, 7.006492321624085e-46, 2e-46, 1e-50)
  values.push(Infinity, -Infinity, 1 + 2 ** -24, 1 + 3 * 2 ** -24, 1 + 2 ** -24 + 2 ** -52)
  for (let i = 0; i < 4000; i++) values.push((next() - 0.5) * 10 ** Math.floor(next() * 90 - 45))
  for (let i = 0; i < 400; i++) values.push((next() - 0.5) * 2 ** -126 * 8)
  for (const value of values) assert.equal(run.toF32(pair(value)) >>> 0, f32Bits(value), `${value}`)
  assert.equal(run.toF32(pair(NaN)) >>> 0, 0x7fc00000)
})

test('parent · local, at the eye, is the CPU world word for word, near and far from the origin', () => {
  const next = random(11)
  const product = new Float64Array(16),
    atEye = new Float32Array(16),
    rows = new Float32Array(16)
  for (let i = 0; i < 300; i++) {
    const far = [10, 1e4, 1e7][i % 3]
    const grand = generated(next, far),
      parent = new Float64Array(16)
    // Two levels on the CPU, as the tree composes them: the GPU takes the parent's world.
    multiplyMatrix4(parent, grand, generated(next, far))
    const local = generated(next, 20)
    const eye = [0, 1, 2].map(() => (next() - 0.5) * far)
    multiplyMatrix4(product, parent, local)
    rows.set(product)
    worldToRenderOrigin(atEye, product, eye)
    parents.splice(0, 16, ...Array.from(parent, pair))
    locals.splice(0, 16, ...Array.from(local, pair))
    for (let k = 0; k < 16; k++) {
      const value = run.composed(0, 0, k)
      assert.equal(run.toF32(value) >>> 0, f32Bits(rows[k]), `row word ${k}, case ${i}`)
      const brought = k >= 12 && k < 15 ? run.dSub(value, pair(eye[k - 12])) : value
      assert.equal(run.toF32(brought) >>> 0, f32Bits(atEye[k]), `cut word ${k}, case ${i}`)
    }
  }
})
