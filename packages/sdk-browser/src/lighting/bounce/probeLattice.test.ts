// The lattice of the radiance cache's probes, as the reference lays it: a level's corner is its snapped origin less half a cell and half its
// cube, a probe stands at the corner plus its coordinate and a half cells — a multiple of the cell's side —, a point's coordinate is its
// distance from the corner over the side, the first of the eight probes round it the floor of that coordinate less a half, the weights of
// their interpolation its fraction. The shipped text is run beside a twin of those formulas written here from the reference alone.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { createBounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { bounceBindingsWgsl } from './gridWgsl.ts'
import { CACHE_WORDS_WGSL } from './cache/cacheWordsWgsl.ts'
import { spCacheRead } from './screen/cacheReadWgsl.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { ATLAS_CALLS, cellProbes } from './atlas.fixture.ts'

type Vec = number[]

/** Origins the levels follow: the first on a cell's corner, the others with negative axes and far from the world's. */
const ORIGINS: Vec[] = [
  [0, 0, 0],
  [3.7, -2.2, 100.9],
  [-57.3, 1.7, -0.01],
  [-1000.4, 5, 333.3],
]

const cascades = createBounceCascades([-2000, -10, -2000, 2000, 100, 2000])
const { size } = cascades

/** The levels' uniform over the cascades as they stand. */
const uniform = () => ({
  reach: [200, SCREEN_PROBE_CONSTANTS.radianceProbeMinTraceScale, 1, 1],
  counts: [size, cascades.levels.length, cascades.cells, cascades.probes],
  levels: cascades.levels.map(({ base, spacing }) => ({ base: [...base], spacing })),
  forward: [0, 0, 0, 0],
})

/** A level of the reference's clipmap round `origin`: the origin snapped down to whole cells, the corner half a cell and half the cube before
 *  it; a probe of coordinate `k` at the corner plus `(k + 0.5)` cells; a point's coordinate its distance from the corner in cells. */
function referenceLevel(origin: Vec, spacing: number) {
  const snapped = origin.map((v) => Math.floor(v / spacing) * spacing)
  const corner = snapped.map((v) => v - 0.5 * spacing - (size * spacing) / 2)
  const coordFloat = (P: Vec) => P.map((v, axis) => (v - corner[axis]) / spacing)
  return {
    snapped,
    position: (k: Vec) => k.map((v, axis) => corner[axis] + (v + 0.5) * spacing),
    coordFloat,
    coord: (P: Vec) => coordFloat(P).map(Math.floor),
    bottomCorner: (P: Vec) => coordFloat(P).map((v) => Math.floor(v - 0.5)),
    fraction: (P: Vec) =>
      coordFloat(P).map((v) => {
        const corner = v - 0.5
        return corner - Math.floor(corner)
      }),
    /** The level the reference picks for `P`: the first whose edge fade, from the first probe to a fade size inside, is above `random`. */
    pick: (P: Vec, random: number, inverseFade: number) => {
      const coord = coordFloat(P)
      const bottom = coord.map((v) => Math.min(Math.max((v - 0.5) * inverseFade, 0), 1))
      const top = coord.map((v) => Math.min(Math.max((size - 0.5 - v) * inverseFade, 0), 1))
      return Math.min(...bottom, ...top) > random
    },
  }
}

const kit = () =>
  shaderRun<{
    probePosition: (cell: Vec, spacing: number) => Vec
    probeCoordFloat: (level: number, P: Vec) => Vec
    probeBottomCell: (level: number, P: Vec) => Vec
    probeFraction: (level: number, P: Vec) => Vec
    bounceRead: (level: number, P: Vec) => { corner: Vec; fade: number }
    cacheCoverage: (P: Vec, random: number) => { level: number; valid: boolean }
  }>(
    wgslModule(bounceBindingsWgsl(0, 0, 1), CACHE_WORDS_WGSL),
    [
      'probePosition',
      'probeCoordFloat',
      'probeBottomCell',
      'probeFraction',
      'bounceRead',
      'cacheCoverage',
    ],
    { bounce: uniform(), cellTable: {} },
  )

/** The levels followed to `origin`, and the shaders over them. */
const follow = (origin: Vec) => {
  cascades.follow(origin)
  return kit()
}

test('the probe of a cell stands where the reference puts the probe of its coordinate, a multiple of the cell’s side', () => {
  for (const origin of ORIGINS) {
    const shader = follow(origin)
    cascades.levels.forEach(({ base, spacing }, level) => {
      const reference = referenceLevel(origin, spacing)
      for (const k of [
        [0, 0, 0],
        [size / 2, size / 2, size / 2],
        [size - 1, size - 1, size - 1],
        [5, 30, 11],
      ]) {
        const cell = k.map((v, axis) => base[axis] + v)
        const where = shader.probePosition(cell, spacing)
        const label = `origin ${origin}, level ${level}, coordinate ${k}`
        near(where, reference.position(k), label, 1e-6)
        // The lattice is the world's: the probe of cell n at n · spacing, the cube's cell below the middle one on the snapped origin.
        near(
          where,
          cell.map((n) => n * spacing),
          `${label}: a multiple of the side`,
          1e-9,
        )
        near(
          where,
          origin.map((v, axis) => (Math.floor(v / spacing) - size / 2 + k[axis]) * spacing),
          `${label}: the snapped origin, less half the cube, plus the coordinate`,
          1e-6,
        )
      }
      near(
        shader.probePosition(
          base.map((b) => b + size / 2),
          spacing,
        ),
        reference.snapped,
        `origin ${origin}, level ${level}: the middle probe is on the snapped origin`,
        1e-6,
      )
    })
  }
})

test('the coordinate of a point, the first of the probes round it and the weights between them are the reference’s', () => {
  for (const origin of ORIGINS) {
    const shader = follow(origin)
    cascades.levels.forEach(({ base, spacing }, level) => {
      const reference = referenceLevel(origin, spacing)
      for (const offset of [
        [0.31, -0.77, 1.9],
        [-3.3, 0.02, -0.46],
        [11.5, 8.2, -7.7],
        [-0.2, -0.3, -0.1],
      ]) {
        const P = origin.map((v, axis) => v + offset[axis] * spacing)
        const label = `origin ${origin}, level ${level}, point ${P}`
        near(
          shader.probeCoordFloat(level, P),
          reference.coordFloat(P),
          `${label}: coordinate`,
          1e-6,
        )
        assert.deepEqual(
          shader.probeBottomCell(level, P),
          reference.bottomCorner(P).map((v, axis) => base[axis] + v),
          `${label}: the first of the eight probes`,
        )
        near(shader.probeFraction(level, P), reference.fraction(P), `${label}: weights`, 1e-6)
        // The surface point marks the cells the lit passes read: the one rule.
        assert.deepEqual(
          shader.bounceRead(level, P).corner,
          shader.probeBottomCell(level, P),
          `${label}: the mark names the first probe the read takes`,
        )
      }
    })
  }
})

test('a cell’s probe read back from its place is the same cell: cell to position to cell, the point a quarter cell past a probe lies after it, a quarter before it before it', () => {
  for (const origin of ORIGINS) {
    const shader = follow(origin)
    cascades.levels.forEach(({ base, spacing }, level) => {
      for (const k of [
        [0, 0, 0],
        [23, 24, 25],
        [47, 0, 31],
      ]) {
        const cell = k.map((v, axis) => base[axis] + v)
        const where = shader.probePosition(cell, spacing)
        const label = `origin ${origin}, level ${level}, cell ${cell}`
        // The coordinate of the probe itself is its coordinate and a half: the floor of it is its own.
        assert.deepEqual(
          shader.probeCoordFloat(level, where).map(Math.floor),
          k,
          `${label}: coordinate`,
        )
        const past = where.map((v) => v + 0.25 * spacing)
        assert.deepEqual(shader.probeBottomCell(level, past), cell, `${label}: a quarter past`)
        near(shader.probeFraction(level, past), [0.25, 0.25, 0.25], `${label}: its weight`, 1e-6)
        const before = where.map((v) => v - 0.25 * spacing)
        assert.deepEqual(
          shader.probeBottomCell(level, before),
          cell.map((n) => n - 1),
          `${label}: a quarter before`,
        )
        near(shader.probeFraction(level, before), [0.75, 0.75, 0.75], `${label}: its weight`, 1e-6)
      }
    })
  }
})

test('the level that covers a point is the reference’s pick: the first whose edge fade, from the first probe, is above the number drawn', () => {
  const fade = SCREEN_PROBE_CONSTANTS.radianceInvLevelFadeSize
  for (const origin of ORIGINS) {
    const shader = follow(origin)
    for (const distance of [
      0.2, 5, 11.9, 12.4, 12.55, 24.9, 25.4, 40, 49, 51, 99, 101, 190, 204, 206,
    ]) {
      for (const axis of [0, 1, 2])
        for (const sign of [1, -1]) {
          const P = origin.map((v, a) => (a === axis ? v + sign * distance : v + 0.13))
          for (const random of [0, 0.5, 0.9]) {
            const levels = cascades.levels.map(({ spacing }) => referenceLevel(origin, spacing))
            const picked = levels.findIndex((level) => level.pick(P, random, fade))
            const covered = shader.cacheCoverage(P, random)
            assert.deepEqual(
              [covered.valid, covered.valid ? covered.level : -1],
              [picked >= 0, picked],
              `origin ${origin}, point ${P}, draw ${random}`,
            )
          }
        }
    }
  }
})

test('the eight probes a ray reads are the reference’s, at its weights: the corners of the cell round the point, which the weights bring back to the point', () => {
  const origin = ORIGINS[2]
  cascades.follow(origin)
  const { base, spacing } = cascades.levels[0]
  const reference = referenceLevel(origin, spacing)
  const P = origin.map((v, axis) => v + [0.31, -0.77, 1.9][axis])
  // The cells of the eight probes in the order of the lanes, a slot each: the table names a cell by its slot plus one.
  const bottom = reference.bottomCorner(P)
  const lanes = Array.from({ length: 8 }, (_, lane) =>
    bottom.map((v, axis) => base[axis] + v + ((lane >> axis) & 1)),
  )
  const table = cellProbes(lanes, size)
  const gathered = {
    corner: Array<number>(8).fill(0),
    place: Array.from({ length: 8 }, () => [0, 0, 0]),
    alpha: [0, 0, 0],
    levelHeld: 0,
  }
  const run = shaderRun<{ spCacheGatherOwn: (P: Vec) => void }>(
    wgslModule(bounceBindingsWgsl(0, 0, 1), spCommon([4, 2]), spCacheRead(2, 3, 4, 'private')),
    ['spCacheGatherOwn'],
    {
      bounce: uniform(),
      cellTable: table,
      cacheNow: gathered,
      textureLoad: (_: unknown, at: Vec, layer: number) =>
        ATLAS_CALLS.textureLoad(table, at, layer),
    },
  )
  run.spCacheGatherOwn(P)
  assert.equal(gathered.levelHeld, 1, 'the finest level covers the point')
  // Each lane found the probe of the reference's coordinate: its slot is its lane's, its place the reference's.
  assert.deepEqual(
    gathered.corner,
    lanes.map((_, lane) => lane + 1),
  )
  lanes.forEach((_, lane) =>
    near(
      gathered.place[lane],
      reference.position(bottom.map((v, axis) => v + ((lane >> axis) & 1))),
      `lane ${lane}`,
      1e-6,
    ),
  )
  const alpha = reference.fraction(P)
  near(gathered.alpha, alpha, 'the weights of the interpolation', 1e-6)
  // The trilinear mean of the probes' places is the point: each probe weighs by its share of the cell, as the reference's.
  const mean = [0, 0, 0]
  lanes.forEach((_, lane) => {
    const share = alpha.reduce((product, a, axis) => product * ((lane >> axis) & 1 ? a : 1 - a), 1)
    gathered.place[lane].forEach((v, axis) => (mean[axis] += share * v))
  })
  near(mean, P, 'the interpolation of the places is the point', 1e-6)
})
