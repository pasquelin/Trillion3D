// What the compose passes derive from a composed world (`gpuComposeDerivedWgsl.ts`, the shipped
// WGSL run in JavaScript) is what the CPU writes from the same world and the same inputs, word for
// word: the eight Hi-Z corners (`packPageCorners`), the shadow detail words (`writeRowLod`) and the
// root's world box (`refreshRootBox`). Generated families: rotations, uneven, negative and sheared
// worlds near and far from the origin, boxes and spheres of every size, a reach and a dynamic
// box now and then, every combination of the cut rule's residency, rows with and without a
// coarser form, roots with and without a box.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { random } from '../page/cut/cutRuleChecks.fixture.ts'
import { refreshRootBox } from '../page/selection/batchBoxes.ts'
import { packPageCorners } from '../webgpu/visibility/corners.ts'
import { ROW_LOD_FLOATS, writeRowLod } from '../webgpu/shadow/rowLodWords.ts'
import { CORNER_VALUES } from '../gpu/partition/contract.ts'
import { COMPOSE_ROOTS_WGSL, COMPOSE_ROWS_WGSL } from './gpuComposeWgsl.ts'
import { ROW_INPUT_DOUBLES, packInputs, rowInputs } from './composedRowInputs.ts'
import {
  DOUBLE_HELPERS,
  countLeadingZeros,
  generated,
  pair,
  type Pair,
} from './composeDoubles.fixture.ts'
import type { PageRec } from '../page/selection/selection.ts'

const FAMILY = 400
const SPLIT = ['dSub', 'toF32', 'fromF32', 'splitDouble', 'affineAxis']
const STRETCH = ['dDiv', 'dLess', 'dRsqrt', 'dSqrt', 'chebyshevRoot', 'maxStretchOf']

const rows = {
  inputs: [] as Pair[],
  corners: [] as number[],
  lods: [] as number[],
  rootBoxes: [] as Pair[],
}
const derived = shaderRun<{
  composeCorners(row: number, world: Pair[]): void
  composeLod(row: number, rank: number, world: Pair[]): void
}>(
  COMPOSE_ROWS_WGSL,
  [...DOUBLE_HELPERS, ...SPLIT, ...STRETCH, 'composeCorners', 'lodCentre', 'composeLod'],
  {
    countLeadingZeros,
    ...rows,
  },
)
const roots = { rootInputs: [] as Pair[], rootBoxes: [] as Pair[] }
const boxes = shaderRun<{ composeBox(rank: number, at: number, world: Pair[]): void }>(
  COMPOSE_ROOTS_WGSL,
  [...DOUBLE_HELPERS, 'affineAxis', 'dLess', 'dIsZero', 'dMin', 'dMax', 'carriedBox', 'composeBox'],
  { countLeadingZeros, ...roots },
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

const f32Bits = (words: Float32Array) => [...new Uint32Array(words.buffer)]
const doubleOf = (p: Pair) => {
  const cell = new Uint32Array([p[1] >>> 0, p[0] >>> 0])
  return new Float64Array(cell.buffer)[0]
}

test('the corners, the detail and the world box a parent’s move derives are the CPU’s, word for word', () => {
  const next = random(41)
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
    if (root.worldBox) refreshRootBox(root as never)
    const cornersCpu = new Float32Array(CORNER_VALUES)
    packPageCorners(cornersCpu, 0, rec, root.world, root.reach)
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
    // The box is one the root's local box carries: its inputs as the roots pass reads them.
    roots.rootInputs.splice(0, 7, ...[...local, 0].map((v) => pair(v)))
    roots.rootInputs[6] = [root.worldBox ? 1 : 0, 0]
    boxes.composeBox(0, 0, doubles)
    if (root.worldBox) {
      withBox++
      assert.deepEqual(
        roots.rootBoxes.slice(0, 6).map(doubleOf),
        [...root.worldBox],
        `world box, case ${i}`,
      )
    }
    rows.rootBoxes.splice(0, 6, ...roots.rootBoxes.slice(0, 6))
    rows.corners.length = CORNER_VALUES
    derived.composeCorners(0, doubles)
    assert.deepEqual(
      rows.corners.map((w) => w >>> 0),
      f32Bits(cornersCpu),
      `corners, case ${i}`,
    )
    rows.lods.length = ROW_LOD_FLOATS
    derived.composeLod(0, 0, doubles)
    assert.deepEqual(
      rows.lods.map((w) => w >>> 0),
      f32Bits(lodCpu),
      `detail, case ${i}`,
    )
  }
  assert.ok(withBox > FAMILY / 2, 'the family holds roots with a world box')
})
