// What the rows pass and the root boxes pass derive from a world (`gpuComposeDerivedWgsl.ts`, the
// shipped WGSL run in JavaScript) is what the CPU formulas give from the same world and the same
// inputs, word for word: the shadow detail words (the oracle `writeRowLod`) and the root's world
// box (`rootWorldBox`). Generated families: rotations, uneven, negative and sheared
// worlds near and far from the origin, boxes and spheres of every size, a reach and a dynamic
// box now and then, every combination of the cut rule's residency, rows with and without a
// coarser form, roots with and without a box. The detail reads the stretch the root's words hold.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import { f64WordsInto, fromF32Bits } from '../../../../math/src/float/bits.ts'
import { rootWorldBox } from '../../geometry/selection/rootWorld.ts'
import {
  LOD_INPUT,
  LOD_OBJECT,
  ROW_LOD_FLOATS,
} from '../../lighting/shadows/casters/rowLodWords.ts'
import { writeRowLod } from '../../lighting/shadows/casters/rowLodWords.fixture.ts'
import { ROOT_BOXES_WGSL } from '../roots/rootBoxesWgsl.ts'
import { DERIVE_ROWS_WGSL } from '../rows/rowWordsWgsl.ts'
import { LOD_WGSL } from './gpuComposeDerivedWgsl.ts'
import { ROOT_BOX_DOUBLES } from '../roots/rootWorldSends.ts'
import { toF32 } from '../../../../math/src/wgsl/f32.ts'
import { ROW_INPUT_DOUBLES, packInputs, rowInputs } from '../rows/rowInputPack.ts'
import { DOUBLE_HELPERS, generated, pair, type Pair } from './composeDoubles.fixture.ts'
import type { PageRec } from '../../geometry/selection/types.ts'

const FAMILY = 400
const SPLIT = ['dSub', 'toF32', 'fromF32', 'splitDouble', 'affineAxis']
const STRETCH = ['dDiv', 'dRsqrt', 'dSqrt', 'chebyshevRoot', 'maxStretchOf']

const rows = {
  inputs: [] as Pair[],
  lods: [] as number[],
  rootBoxes: [] as Pair[],
}
const derived = shaderRun<{
  composeLod(row: number, rank: number, world: Pair[]): void
}>(DERIVE_ROWS_WGSL, [...DOUBLE_HELPERS, ...SPLIT, 'lodCentre', 'composeLod'], {
  ...rows,
})
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

/** A page of a family: its box, its spheres, its errors, its level, now and then a dynamic box. */
function page(next: () => number, scale: number) {
  const centre = [0, 1, 2].map(() => (next() - 0.5) * 20 * scale),
    half = [0, 1, 2].map(() => (0.01 + next() * 4) * scale)
  const sphere = (extra: number) => [...centre, Math.hypot(...half) * (1 + extra)]
  const rec = {
    min: centre.map((c, i) => c - half[i]),
    max: centre.map((c, i) => c + half[i]),
    sphere: sphere(0),
    parentSphere: next() < 0.8 ? sphere(next()) : undefined,
    lodError: next() * 3 * scale,
    parentError: next() < 0.85 ? next() * 6 * scale : null,
    level: Math.floor(next() * 3),
  } as unknown as PageRec & { moved?: unknown }
  if (next() < 0.15) {
    const lo = centre.map((c) => c - next() * scale),
      hi = centre.map((c) => c + next() * scale)
    rec.moved = { min: lo, max: hi }
  }
  return rec
}

const wordsOf = (words: Float32Array) => [...new Uint32Array(words.buffer)]
const doubleOf = (p: Pair) => {
  const cell = new Uint32Array([p[1] >>> 0, p[0] >>> 0])
  return new Float64Array(cell.buffer)[0]
}

test('the detail and the world box a world derives are the CPU formulas’, word for word', () => {
  const next = lcgRandom(41)
  let withBox = 0
  const scratch = new Float64Array(ROW_INPUT_DOUBLES),
    packed = new Uint32Array(ROW_INPUT_DOUBLES * 2)
  for (let i = 0; i < FAMILY; i++) {
    const far = [10, 1e3, 1e6][i % 3],
      scale = [0.1, 1, 30][i % 3]
    const world = generated(next, far),
      rec = page(next, scale)
    const local = [...rec.min, ...rec.max]
    const root = {
      world: { elements: world },
      reach: next() < 0.3 ? next() * scale : undefined,
      localBox: Float64Array.from(local),
      worldBox: next() < 0.8 ? new Float64Array(6) : undefined,
    }
    const ready = next() < 0.8,
      childReady = next() < 0.8
    // The CPU: the root's box carried by its world, then the row's words from it.
    const lodCpu = new Float32Array(ROW_LOD_FLOATS)
    writeRowLod(lodCpu, 0, rec, root as never, ready, childReady)
    // The GPU: the inputs as the table keeps them, the world as the passes hold it.
    rowInputs(scratch, 0, rec, root as never, ready, childReady)
    packInputs(packed, 0, scratch)
    rows.inputs.splice(
      0,
      rows.inputs.length,
      ...Array.from({ length: ROW_INPUT_DOUBLES }, (_, k) => [packed[k * 2], packed[k * 2 + 1]]),
    )
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
    rows.rootBoxes.splice(0, ROOT_BOX_DOUBLES, ...roots.rootBoxes.slice(0, ROOT_BOX_DOUBLES))
    rows.lods.length = ROW_LOD_FLOATS
    derived.composeLod(0, 0, doubles)
    assert.deepEqual(
      rows.lods.map((w) => w >>> 0),
      wordsOf(lodCpu),
      `detail, case ${i}`,
    )
  }
  assert.ok(withBox > FAMILY / 2, 'the family holds roots with a world box')
})

test('a row’s object is its root’s box, or its actor’s for a page of the world DAG: every row of it alike', () => {
  const pageOf = (id: number, min: number[], max: number[], layer?: number) =>
    ({
      id,
      min,
      max,
      hlodLayer: layer,
      sphere: [...min, 1],
      lodError: 1,
      level: 0,
    }) as unknown as PageRec
  const pages = [
    pageOf(0, [0, 0, 0], [10, 10, 10], 1),
    pageOf(1, [20, 0, 0], [30, 10, 10], 1),
    pageOf(2, [500, 500, 500], [510, 520, 530], 2),
    pageOf(3, [-5, -5, -5], [5, 5, 5]),
  ]
  const hlod = { cells: Int32Array.from([0, 0, 1, -1]), parent: Int32Array.from([-1, -1]) }
  const root = (extra: object) => ({
    world: { elements: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 40, 0, 0, 1]) },
    localBox: Float64Array.from([-1000, -1000, -1000, 1000, 1000, 1000]),
    worldBox: new Float64Array(6),
    pages,
    hlod,
    ...extra,
  })
  // The offset of the object's centre from the page's own, then its radius: four singles.
  const object = (rec: PageRec, held: object) => {
    const into = new Float64Array(ROW_INPUT_DOUBLES),
      words = new Uint32Array(4)
    rowInputs(into, 0, rec, held as never, true, true)
    f64WordsInto(words, 0, into[6 + LOD_INPUT.object])
    f64WordsInto(words, 2, into[6 + LOD_INPUT.object + 1])
    return Array.from(words, fromF32Bits)
  }
  const radius0 = Math.fround(length3(30, 10, 10) / 2),
    radius1 = Math.fround(length3(10, 20, 30) / 2)
  assert.deepEqual(object(pages[0], root({})), [10, 0, 0, radius0], 'the actor of cell 0')
  assert.deepEqual(object(pages[1], root({})), [-10, 0, 0, radius0], 'its other page: the same')
  assert.deepEqual(object(pages[2], root({})), [0, 0, 0, radius1], 'cell 1, about its one page')
  // A page that belongs to no HLOD layer, or a root that is none's, is its root's whole box.
  const whole = Math.fround(length3(2000, 2000, 2000) / 2)
  assert.deepEqual(object(pages[3], root({})), [0, 0, 0, whole], 'a page drawn as itself')
  assert.deepEqual(object(pages[0], root({ hlod: undefined })), [-5, -5, -5, whole], 'no world DAG')
  assert.equal(object(pages[0], root({ reach: 2 }))[3], Math.fround(radius0 + 2), 'by the reach')
  assert.deepEqual(object(pages[0], root({ worldBox: undefined })), [0, 0, 0, 0], 'no box, none')
  const unbounded = Float64Array.from([
    -Infinity,
    -Infinity,
    -Infinity,
    Infinity,
    Infinity,
    Infinity,
  ])
  assert.deepEqual(
    object(pages[3], root({ localBox: unbounded })),
    [0, 0, 0, 0],
    'none a single holds',
  )
  // The GPU's words for a page of an actor, the CPU's word for word: radius by the stretch, the
  // offset of the actor's world centre from the page's own.
  const next = lcgRandom(5)
  for (let i = 0; i < 20; i++) {
    const world = generated(next, [10, 1e3, 1e6][i % 3]),
      held = root({ world: { elements: world } })
    const cpu = new Float32Array(ROW_LOD_FLOATS)
    writeRowLod(cpu, 0, pages[i % 3], held as never)
    const scratch = new Float64Array(ROW_INPUT_DOUBLES),
      packed = new Uint32Array(ROW_INPUT_DOUBLES * 2)
    rowInputs(scratch, 0, pages[i % 3], held as never, true, true)
    packInputs(packed, 0, scratch)
    rows.inputs.splice(
      0,
      rows.inputs.length,
      ...Array.from({ length: ROW_INPUT_DOUBLES }, (_, k) => [packed[k * 2], packed[k * 2 + 1]]),
    )
    const doubles = Array.from(world, pair)
    roots.rootInputs.splice(0, 7, ...[...held.localBox, 1].map((v) => pair(v)))
    boxes.composeRoot(0, doubles)
    rows.rootBoxes.splice(0, ROOT_BOX_DOUBLES, ...roots.rootBoxes.slice(0, ROOT_BOX_DOUBLES))
    rows.lods.length = ROW_LOD_FLOATS
    derived.composeLod(0, 0, doubles)
    assert.deepEqual(
      rows.lods.map((w) => w >>> 0),
      wordsOf(cpu),
      `an actor's page, case ${i}`,
    )
    assert.ok(cpu[LOD_OBJECT + 3] > 0, 'the object has a radius')
    // Page 0 is off its actor's centre by 10 along its local x: the offset is that column's length.
    const column = 10 * length3(world[0], world[1], world[2])
    if (i % 3 === 0)
      near(length3(...cpu.slice(LOD_OBJECT, LOD_OBJECT + 3)), column, 'the offset', column * 1e-5)
  }
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

test('the detail words name the rounding they call, whatever the stretch below them calls', () => {
  assert.ok(LOD_WGSL.deps.includes(toF32), 'toF32 is a dependency of its own, not a borrowed one')
})
