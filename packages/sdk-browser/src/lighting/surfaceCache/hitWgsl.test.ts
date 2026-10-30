// The surface a march through the global field met (`scGlobalHit`, `hitWgsl.ts`), the shipped WGSL run as JavaScript
// (`shaderRun`) over a cell of the field's object grid and the cache's read library standing in as each test says.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'
import {
  surfaceHitBindingsFrom,
  surfaceHitCardsWgsl,
  surfaceHitLayoutEntries,
  surfaceHitWgsl,
  type SurfaceHitBindings,
} from './hitWgsl.ts'
import { NO_MESH_CARDS } from './layout.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'

/** What the cache's library was asked, call by call. */
type Read = {
  cards: number
  position: Vec3
  normal: Vec3
  radius: number
  bias: number
  hiRes: boolean
}

/** The voxel of the clipmap the hits are in: 2520 cm of half-extent over 252 voxels. */
const VOXEL = 10

/** The grid's empty word. */
const NONE = 0xffffffff

/** What a test says of the hit: the grid cell (the instances it names), the table of instances (the count, then each instance's
 *  placement), the weight each placement's cards (its number plus a hundred) give, the ray's rules. */
interface Hit {
  hitTime?: number
  fade?: boolean
  startedInside?: number
  hiRes?: boolean
  spread?: number
  cell?: number[]
  instances?: number[]
  weights?: Record<number, number>
}

/**
 * `scGlobalHit` of a hit `hitTime` centimetres along +x from `origin`, 10 cm along x, in the clipmap 2: each card read gives the
 * weight of the test, the light `[2, 4, 6]` times the weights' sum, valid where it is not 0. `spread` is the tangent of the
 * cone's half angle; the ray `fade`s or not and counts a hit at or before `startedInside` as one from inside a surface.
 */
function hitSurface({
  hitTime = 200,
  fade = false,
  startedInside = -1,
  hiRes = false,
  spread = 0.01,
  cell = [0, NONE, NONE, NONE],
  instances = [1, 7],
  weights = { 107: 1 },
}: Hit = {}) {
  const text = wgslModule(surfaceHitWgsl(surfaceHitBindingsFrom(0, 0), WORD_LIGHT_FORMAT, false))
  const reads: Read[] = []
  const grid: { at: Vec3[]; clipmaps: number[] } = { at: [], clipmaps: [] }
  const evaluated: number[][] = []
  const { scGlobalHit } = shaderRun<{
    scGlobalHit: (
      origin: Vec3,
      dir: Vec3,
      hit: object,
      spread: number,
      fade: boolean,
      startedInside: number,
      hiRes: boolean,
      coord: number[],
    ) => { radiance: Vec3; face: Vec3; valid: boolean; instance: number }
  }>(text, ['scGlobalHit'], {
    hitInstances: instances,
    gdfView: {
      centerExtent: [
        [0, 0, 0, 630],
        [0, 0, 0, 1260],
        [0, 0, 0, 2520],
      ],
      texel: 1 / 252,
      translation: [0, 0, 0],
    },
    gdfTranslated: (p: Vec3) => p,
    gdfNormal: () => [0, 1, 0],
    gdfObjectGridCellOf: (at: Vec3, clipmap: number) => (
      grid.at.push(at),
      grid.clipmaps.push(clipmap),
      cell
    ),
    scPlacementMeshCards: (placement: number) =>
      placement === NO_MESH_CARDS ? NO_MESH_CARDS : 100 + placement,
    scAccumulator: () => ({ weightSum: 0 }),
    scSampleMeshCards: (
      cards: number,
      position: Vec3,
      normal: Vec3,
      radius: number,
      bias: number,
      read: boolean,
      acc: { get(): { weightSum: number } },
    ) => {
      reads.push({ cards, position, normal, radius, bias, hiRes: read })
      acc.get().weightSum += weights[cards] ?? 0
    },
    scEvaluate: (acc: { weightSum: number }, coord: number[]) => (
      evaluated.push(coord),
      {
        radiance: [2 * acc.weightSum, 4 * acc.weightSum, 6 * acc.weightSum],
        valid: acc.weightSum > 0,
      }
    ),
  })
  const surface = scGlobalHit(
    [10, 0, 0],
    [1, 0, 0],
    { hitTime, clipmap: 2, steps: 0, expand: 0 },
    spread,
    fade,
    startedInside,
    hiRes,
    [5, 6],
  )
  return { surface, reads, grid, evaluated }
}

test('a ray that expands by its time brings none of its light from a hit nearer than a voxel and a half and all of it from two', () => {
  const near = hitSurface({ hitTime: 14, fade: true })
  assert.deepEqual(near.surface.radiance, [0, 0, 0])
  assert.equal(near.reads.length, 0, 'nothing is read for a hit that brings none')
  assert.equal(hitSurface({ hitTime: 14, fade: true }).surface.valid, false)
  assert.deepEqual(
    hitSurface({ hitTime: 17.5, fade: true }).surface.radiance,
    [1, 2, 3],
    'half way: smoothstep one half',
  )
  assert.deepEqual(hitSurface({ hitTime: 20, fade: true }).surface.radiance, [2, 4, 6])
  assert.deepEqual(
    hitSurface({ hitTime: 14 }).surface.radiance,
    [2, 4, 6],
    'a ray that does not fade reads a near hit whole',
  )
})

test('a ray that started inside a surface brings none of its light, whatever its time', () => {
  assert.deepEqual(hitSurface({ hitTime: 30, startedInside: 30 }).surface.radiance, [0, 0, 0])
  assert.deepEqual(hitSurface({ hitTime: 0, startedInside: 0 }).surface.radiance, [0, 0, 0])
  assert.deepEqual(hitSurface({ hitTime: 31, startedInside: 30 }).surface.radiance, [2, 4, 6])
  // A ray with no such rule starts below any time a hit can take.
  assert.deepEqual(hitSurface({ hitTime: 0 }).surface.radiance, [2, 4, 6])
})

test('a hit reads the cards of the objects of its grid cell, nearest first, until the cards have given nine tenths of a weight', () => {
  // Four objects the grid names, the instances 0 to 3 of the table, placements 7, 8, 9 and 10; the first gives 0.5, the second 0.5.
  const cell = [0, 1, 2, 3]
  const instances = [4, 7, 8, 9, 10]
  const { surface, reads } = hitSurface({
    cell,
    instances,
    weights: { 107: 0.5, 108: 0.5, 109: 0.5 },
  })
  assert.deepEqual(
    reads.map((read) => read.cards),
    [107, 108],
    'the third is not read: 1.0 is past 0.9',
  )
  assert.deepEqual([surface.valid, surface.radiance], [true, [2, 4, 6]])
  // Weights of 0.35 reach 0.9 at the third, which is read; the fourth is not.
  const slow = hitSurface({
    cell,
    instances,
    weights: { 107: 0.35, 108: 0.35, 109: 0.35, 110: 0.35 },
  })
  assert.deepEqual(
    slow.reads.map((read) => read.cards),
    [107, 108, 109],
  )
})

test('the walk of a cell stops at its first place not taken, and an instance past the table has no cards', () => {
  const stopped = hitSurface({
    cell: [0, NONE, 1, NONE],
    instances: [2, 7, 8],
    weights: { 107: 0.2, 108: 0.2 },
  })
  assert.deepEqual(
    stopped.reads.map((read) => read.cards),
    [107],
    'the places after an empty one are not read',
  )
  // The object of instance 5 is past the two the table holds: none, not another's.
  const past = hitSurface({ cell: [5, 0], instances: [2, 7, 8], weights: { 107: 0.4 } })
  assert.deepEqual(
    past.reads.map((read) => read.cards),
    [NO_MESH_CARDS, 107],
  )
})

test('a hit no card gave any weight is dark and not valid, the face is the field’s', () => {
  const { surface } = hitSurface({ weights: {} })
  assert.deepEqual([surface.valid, surface.radiance, surface.face], [false, [0, 0, 0], [0, 1, 0]])
  assert.equal(hitSurface({ cell: [NONE] }).surface.valid, false, 'a cell with no object')
})

test('the cards are read at the hit, three voxels wide, with the footprint of the cone at the hit, the pages the ray asks', () => {
  for (const hiRes of [false, true]) {
    const { reads, grid } = hitSurface({ hiRes })
    // The hit is 200 cm along the ray from the origin (10 cm); its cell is one voxel off the surface along its face.
    assert.deepEqual(reads, [
      {
        cards: 107,
        position: [210, 0, 0],
        normal: [0, 1, 0],
        radius: 0.01 * 200,
        bias: 3 * VOXEL,
        hiRes,
      },
    ])
    assert.deepEqual(grid.at, [[210, VOXEL, 0]])
    assert.deepEqual(grid.clipmaps, [2])
  }
})

test('the light is evaluated for the pixel the ray is traced for, which the feedback is written for', () => {
  assert.deepEqual(hitSurface().evaluated, [[5, 6]])
})

test('the feedback buffer is bound only for a program that writes it', () => {
  // The feedback buffer is the ninth binding of the library: the instances' go past it.
  const b: SurfaceHitBindings = { ...surfaceHitBindingsFrom(0, 0), instances: 16 }
  const bindings = (at: SurfaceHitBindings) =>
    surfaceHitLayoutEntries(at, WORD_LIGHT_FORMAT, false).map((e) => e.binding)
  assert.ok(!bindings(b).includes(b.cards + 8))
  assert.ok(bindings({ ...b, feedback: true }).includes(b.cards + 8))
  assert.ok(
    wgslModule(surfaceHitWgsl({ ...b, feedback: true }, WORD_LIGHT_FORMAT, false)).includes('scFeedback'),
  )
  assert.ok(!wgslModule(surfaceHitWgsl(b, WORD_LIGHT_FORMAT, false)).includes('scFeedback'))
})

test('the placement of a hit and the cone of a ray are read without the global field: a hit found another way reads the cards alone', () => {
  const b = surfaceHitBindingsFrom(0, 0)
  const cards = wgslModule(surfaceHitCardsWgsl(b, WORD_LIGHT_FORMAT))
  for (const name of [
    'scHitPlacement',
    'scConeTangent',
    'scPlacementMeshCards',
    'scEvaluateMeshCards',
  ])
    assert.ok(cards.includes(`fn ${name}(`), name)
  assert.ok(cards.includes(`@binding(${b.instances}) var<storage,read> hitInstances`))
  assert.doesNotMatch(cards, /gdf|Gdf|scGlobalHit/)
  // The march’s read is the cards’ and the field’s.
  const whole = wgslModule(surfaceHitWgsl(b, WORD_LIGHT_FORMAT, false))
  assert.ok(whole.includes('fn scGlobalHit(') && whole.includes('fn scHitPlacement('))
})

test('a hit names the object of its grid cell whose cards gave the most weight, the first of equal ones, and none (all ones) where no card gave any or no light is read', () => {
  const instances = [4, 7, 8, 9, 10]
  const heavy = hitSurface({ cell: [0, 1, 2, NONE], instances, weights: { 107: 0.3, 108: 0.6 } })
  assert.equal(
    heavy.surface.instance,
    1,
    'the second object gave 0.6 against 0.3: the weight each adds, not the sum so far',
  )
  const equal = hitSurface({ cell: [0, 1, NONE, NONE], instances, weights: { 107: 0.4, 108: 0.4 } })
  assert.equal(equal.surface.instance, 0)
  assert.equal(hitSurface({ weights: {} }).surface.instance, 0xffffffff, 'no card gave any weight')
  assert.equal(
    hitSurface({ hitTime: 14, fade: true }).surface.instance,
    0xffffffff,
    'a hit that brings no light',
  )
})
