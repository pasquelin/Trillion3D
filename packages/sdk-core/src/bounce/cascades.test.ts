import test from 'node:test'
import assert from 'node:assert/strict'
import { cellSpacing, createBounceCascades } from './cascades.ts'
import { BOUNCE_SETTINGS } from './contracts.ts'
import { near } from '../../../math/src/float/near.fixture.ts'

const { cascadeLevels, cascadeSize, cascadeHalfExtentMetres, cascadeBase, probePool } =
  BOUNCE_SETTINGS

/** Extents of every shape: cubes, long slabs, thin sheets and flat planes, by size per axis. */
const SIZES = [
  ...Array.from({ length: 120 }, (_, i) => [i + 1, i + 1, i + 1]),
  ...Array.from({ length: 300 }, (_, i) => [i + 1, 3, 3]),
  ...Array.from({ length: 60 }, (_, i) => [7 * i + 0.3, 0.2 * i + 0.1, 1.7]),
  [500, 500, 0],
  [10, 1, 1],
  [4000, 900, 120],
  [2680, 60, 1340],
]

/** The bounds of an extent of `sizes` whose low corner is at `at`. */
const boundsOf = (sizes: number[], at: number[]) => [
  ...at,
  ...sizes.map((size, axis) => at[axis] + size),
]

test('the levels are four cubes of 48 cells whose cell doubles: 1.04, 2.08, 4.17 and 8.33 m', () => {
  const { levels, size, cells, probes } = createBounceCascades([0, 0, 0, 10, 10, 10])
  assert.equal(levels.length, cascadeLevels)
  assert.equal(size, cascadeSize)
  assert.equal(cells, cascadeSize ** 3)
  assert.equal(probes, probePool)
  near(
    levels.map((level) => level.spacing),
    [1.0416667, 2.0833333, 4.1666667, 8.3333333],
    'the cells',
    1e-6,
  )
  // The first cube reaches 25 m from the eye, the others 50, 100 and 200.
  near(
    levels.map((level) => (level.spacing * cascadeSize) / 2),
    [25, 50, 100, 200],
    'half extents',
    1e-9,
  )
  levels.forEach((level, i) => assert.equal(level.spacing, cellSpacing(i)))
  assert.equal(cellSpacing(0), (2 * cascadeHalfExtentMetres) / cascadeSize)
  assert.equal(cellSpacing(3), cellSpacing(0) * cascadeBase ** 3)
})

test('a cache of its own shapes its levels: three cubes of 24 cells whose first cell is 2.08 m, centred on the eye', () => {
  const shape = {
    cascadeLevels: 3,
    cascadeSize: 24,
    cascadeHalfExtentMetres: 25,
    cascadeBase: 2,
    probePool: 4096,
  }
  const { levels, size, cells, probes } = createBounceCascades([0, 0, 0, 10, 10, 10], shape)
  assert.deepEqual([levels.length, size, cells, probes], [3, 24, 24 ** 3, 4096])
  near(
    levels.map((level) => level.spacing),
    [2.0833333, 4.1666667, 8.3333333],
    'the cells',
    1e-6,
  )
  assert.equal(cellSpacing(2, shape), levels[2].spacing)
  const cascades = createBounceCascades([0, 0, 0, 10, 10, 10], shape)
  cascades.follow([100, 0, 0])
  assert.equal(cascades.holds(0, Math.floor(100 / cellSpacing(0, shape)), 0, 0), true)
  assert.equal(cascades.holds(0, Math.floor(100 / cellSpacing(0, shape)) + 12, 0, 0), false)
})

test('the cells never depend on the scene: a street is as many cells across wherever it lies', () => {
  const fine = createBounceCascades([0, 0, 0, 3, 3, 3]).levels.map((level) => level.spacing)
  for (const sizes of SIZES)
    for (const at of [
      [0, 0, 0],
      [-37.3, 5.25, -1234.5],
      [0.999, 1e4 - 0.001, -0.001],
    ])
      assert.deepEqual(
        createBounceCascades(boundsOf(sizes, at)).levels.map((level) => level.spacing),
        fine,
        `${sizes} at ${at}`,
      )
  // On a district 2 680 m across, the finest cell is a metre, not a twenty-fifth of the extent.
  assert.ok(createBounceCascades([0, 0, 0, 2680, 60, 1340]).levels[0].spacing < 1.05)
})

/** Asserts the viewpoint lies in the cell at the middle of every level, on every axis. */
function centred(cascades: ReturnType<typeof createBounceCascades>, viewpoint: number[]) {
  for (const level of cascades.levels)
    for (let axis = 0; axis < 3; axis++) {
      const low = level.base[axis] * level.spacing,
        middle = low + (cascades.size / 2) * level.spacing
      assert.ok(
        middle <= viewpoint[axis] && viewpoint[axis] < middle + level.spacing,
        `${viewpoint}: axis ${axis}, middle ${middle}`,
      )
    }
}

test('following the eye centres every level on it, snapped to the cells of its own', () => {
  const cascades = createBounceCascades([0, 0, 0, 1000, 1, 1])
  for (const viewpoint of [
    [0, 0, 0],
    [-3.7, 12.5, 250.3],
    [999, -0.01, 0.5],
    [123456.7, -8.2, 0.001],
  ]) {
    cascades.follow(viewpoint)
    centred(cascades, viewpoint)
  }
})

test('follow reports a move only when a level crosses a cell, on any axis', () => {
  const cascades = createBounceCascades([0, 0, 0, 1000, 1, 1])
  const spacing = cascades.levels[0].spacing
  const at = [0.25 * spacing, 0.25 * spacing, 0.25 * spacing]
  assert.equal(cascades.follow(at), true, 'the first placement moves the levels')
  assert.equal(cascades.follow(at), false)
  assert.equal(cascades.follow(at.map((value) => value + 0.5 * spacing)), false, 'same cell')
  for (let axis = 0; axis < 3; axis++) {
    const next = at.slice()
    next[axis] -= 0.5 * spacing
    assert.equal(cascades.follow(next), true, `axis ${axis}`)
    assert.equal(cascades.follow(at), true, `back on axis ${axis}`)
  }
  // A step of a finer cell moves the finest level alone: the coarser cells hold it.
  const before = cascades.levels.map((level) => level.base.slice())
  assert.equal(cascades.follow([at[0] + spacing, at[1], at[2]]), true)
  assert.notDeepEqual(cascades.levels[0].base, before[0])
  assert.deepEqual(cascades.levels[3].base, before[3], 'the coarsest cell is not crossed')
})

test('a level holds exactly the cells of its cube, and no cell past it', () => {
  const cascades = createBounceCascades([0, 0, 0, 100, 100, 100])
  cascades.follow([10, 20, 30])
  for (let level = 0; level < cascadeLevels; level++) {
    const [bx, by, bz] = cascades.levels[level].base
    assert.ok(cascades.holds(level, bx, by, bz))
    assert.ok(
      cascades.holds(level, bx + cascadeSize - 1, by + cascadeSize - 1, bz + cascadeSize - 1),
    )
    assert.ok(!cascades.holds(level, bx - 1, by, bz))
    assert.ok(!cascades.holds(level, bx, by - 1, bz))
    assert.ok(!cascades.holds(level, bx, by, bz - 1))
    assert.ok(!cascades.holds(level, bx + cascadeSize, by, bz))
    assert.ok(!cascades.holds(level, bx, by + cascadeSize, bz))
    assert.ok(!cascades.holds(level, bx, by, bz + cascadeSize))
  }
})
