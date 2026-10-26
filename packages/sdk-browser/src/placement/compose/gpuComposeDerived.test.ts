// What the root boxes pass derives from a world (`../roots/rootBoxesWgsl.ts`, the shipped WGSL run
// in JavaScript) is what the CPU formula gives from the same world and the same inputs, word for
// word: the root's world box (`rootWorldBox`). Generated families: rotations, uneven, negative and
// sheared worlds near and far from the origin, boxes of every size, roots with and without a box.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { rootWorldBox } from '../../geometry/selection/rootWorld.ts'
import { ROOT_BOXES_WGSL } from '../roots/rootBoxesWgsl.ts'
import { DOUBLE_HELPERS, generated, pair, type Pair } from './composeDoubles.fixture.ts'

const FAMILY = 400
const STRETCH = ['dDiv', 'dRsqrt', 'dSqrt', 'chebyshevRoot', 'maxStretchOf']

const roots = { rootInputs: [] as Pair[], rootBoxes: [] as Pair[] }
const boxes = shaderRun<{ composeRoot(rank: number, world: Pair[]): Pair }>(
  ROOT_BOXES_WGSL,
  [
    ...DOUBLE_HELPERS,
    ...STRETCH,
    ...[
      'toF32',
      'fromF32',
      'dLess',
      'dIsZero',
      'dIsFinite',
      'dIsNan',
      'dMin',
      'dMax',
      'carriedBox',
      'composeRoot',
    ],
  ],
  roots,
)

const doubleOf = (p: Pair) => {
  const cell = new Uint32Array([p[1] >>> 0, p[0] >>> 0])
  return new Float64Array(cell.buffer)[0]
}

test('the world box a world derives is the CPU formula’s, word for word', () => {
  const next = lcgRandom(41)
  let withBox = 0
  for (let i = 0; i < FAMILY; i++) {
    const far = [10, 1e3, 1e6][i % 3],
      scale = [0.1, 1, 30][i % 3]
    const world = generated(next, far)
    const centre = [0, 1, 2].map(() => (next() - 0.5) * 20 * scale),
      half = [0, 1, 2].map(() => (0.01 + next() * 4) * scale)
    const local = [...centre.map((c, k) => c - half[k]!), ...centre.map((c, k) => c + half[k]!)]
    const root = {
      world: { elements: world },
      reach: next() < 0.3 ? next() * scale : undefined,
      localBox: Float64Array.from(local),
      worldBox: next() < 0.8 ? new Float64Array(6) : undefined,
    }
    const doubles = Array.from(world, pair)
    // The box is one the root's local box carries: its inputs as the root boxes pass reads them.
    roots.rootInputs.splice(0, 7, ...[...local, 0].map((v) => pair(v)))
    roots.rootInputs[6] = [root.worldBox ? 1 : 0, 0]
    boxes.composeRoot(0, doubles)
    if (root.worldBox) {
      withBox++
      assert.deepEqual(
        roots.rootBoxes.slice(0, 6).map(doubleOf),
        [...rootWorldBox(root)!],
        `world box, case ${i}`,
      )
    }
  }
  assert.ok(withBox > FAMILY / 2, 'the family holds roots with a world box')
})

test('a box with a bound not finite is carried as the CPU carries it: every bound NaN', () => {
  const next = lcgRandom(7)
  for (const local of [
    [-Infinity, -1, -1, 1, 1, 1],
    [-1, -1, -1, 1, Infinity, 1],
    [-1, NaN, -1, 1, 1, 1],
  ]) {
    const world = generated(next, 10)
    const root = {
      world: { elements: world },
      localBox: Float64Array.from(local),
      worldBox: new Float64Array(6),
    }
    roots.rootInputs.splice(0, 7, ...[...local, 1].map((v) => pair(v)))
    roots.rootBoxes.length = 0
    boxes.composeRoot(0, Array.from(world, pair))
    const cpu = [...rootWorldBox(root as never)!]
    assert.ok(cpu.every(Number.isNaN), `the CPU's box, ${local}`)
    assert.deepEqual(roots.rootBoxes.slice(0, 6).map(doubleOf), cpu, `${local}`)
  }
})

test('the oriented box a world derives: each column of its linear part times the local half extent along it', () => {
  // A world that scales by (2, 3, 4) and turns a quarter about z: column 0 (0, 2, 0), column 1 (-3, 0, 0).
  const world = [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1]
  roots.rootInputs.splice(0, 7, ...[-1, -2, -3, 1, 2, 3, 0].map((v) => pair(v)))
  roots.rootInputs[6] = [1, 0]
  roots.rootBoxes.length = 0
  boxes.composeRoot(0, world.map(pair))
  // Nine singles from double 11, two to a double: the words' bits, not doubles.
  const bits = new Uint32Array(10),
    floats = new Float32Array(bits.buffer)
  for (let k = 0; k < 5; k++) bits.set(roots.rootBoxes[11 + k]!, 2 * k)
  assert.deepEqual(
    Array.from(floats.subarray(0, 9)),
    [0, 2, 0, -6, 0, 0, 0, 0, 12],
    'half axes: column 0 x 1, column 1 x 2, column 2 x 3',
  )
  assert.deepEqual(
    roots.rootBoxes.slice(7, 10).map(doubleOf),
    [5, 6, 7],
    'the ball’s centre: the local box’s middle (the origin) carried',
  )
})
