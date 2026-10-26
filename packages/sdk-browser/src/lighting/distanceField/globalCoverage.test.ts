// The coverage atlas of the global distance field and its object grid, on the shipped text (`globalTraceWgsl.test.ts`):
// a page reached by two-sided meshes alone covered where the atlas says, the atlas filtered over a page's lattice, and
// the object grid's cells kept, sorted and found from a position.
import test from 'node:test'
import assert from 'node:assert/strict'
import { build, buildGrid, type Vec3 } from './syntheticField.fixture.ts'
import { DOWN, START, march, plane } from './globalTrace.fixture.ts'

test('a page flagged as reached by two-sided meshes alone is covered where its coverage atlas says, not with the simple coverage', () => {
  const expand = (more: object) =>
    march(build({ extents: [140], sdf: plane, flagged: () => true, ...more }), START, DOWN, 400)
      .expand
  // A coverage of 1 at the surface (a one-sided mesh reaches it): the expansion of a covered page, 5.
  assert.ok(Math.abs(expand({ coverage: () => 1 }) - 5) < 1e-4)
  // 0 (only two-sided meshes): 0.6 of it; the coverage between, between: a byte holds 128 for a half.
  assert.ok(Math.abs(expand({ coverage: () => 0 }) - 3) < 1e-4)
  assert.ok(Math.abs(expand({ coverage: () => 0.5 }) - 5 * (0.6 + 0.4 * (128 / 255))) < 1e-3)
  // The simple coverage leaves the atlas unread: the flagged page is wholly not covered.
  assert.ok(Math.abs(expand({ coverage: () => 1, simple: true }) - 3) < 1e-4)
})

test('the coverage atlas is filtered over the lattice of a page, 3 voxels of it across the page’s 7', () => {
  // The lattice holds a coverage of 0 at its voxel (1, 1, 1) of the first page, 1 elsewhere. A voxel of the field
  // is 10 cm, the lattice voxel (1, 1, 1) is the field’s voxel (2, 2, 2): the place -120 cm along each axis.
  const field = build({
    extents: [140],
    sdf: plane,
    flagged: () => true,
    coverage: (p) => (p.every((c) => Math.abs(c + 120) < 1e-6) ? 0 : 1),
  })
  const local = (lattice: Vec3) => lattice.map((c) => (c * 7) / 3) as Vec3
  assert.ok(Math.abs(field.gdfCoverageSample(0, local([1, 1, 1]))) < 1e-5, 'on the voxel')
  assert.ok(Math.abs(field.gdfCoverageSample(0, local([1.5, 1, 1])) - 0.5) < 1e-5, 'between')
  assert.ok(Math.abs(field.gdfCoverageSample(0, local([2, 1, 1])) - 1) < 1e-5)
  assert.ok(Math.abs(field.gdfCoverageSample(0, local([1.5, 1.5, 1])) - 0.75) < 1e-5)
  assert.equal(field.gdfCoverageSample(0, [7, 7, 7]), 1, 'the far corner of the page')
  assert.equal(field.gdfCoverageSample(0, [0, 0, 0]), 1, 'the near corner')
})

test('the object grid keeps the four nearest objects of a cell, sorted by distance, and finds a cell from a position', () => {
  const pages = 4
  const cells = new Uint32Array(pages ** 3 * 64 * 4)
  // Each cell holds, in its first word, its own place in the buffer.
  for (let at = 0; at < cells.length / 4; at++)
    cells.set([at, 0xffffffff, 0xffffffff, 0xffffffff], 4 * at)
  const grid = buildGrid({ extents: [140], sdf: plane, pages }, cells)
  const EXTENT = 8
  const REACH = 30
  const EMPTY = [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff]
  // Six objects offered, the nearest four kept; a nearer one takes the place of the farthest held.
  let cell = EMPTY
  for (const [instance, distance] of [
    [7, 20],
    [3, 5],
    [9, 25],
    [1, 10],
    [4, 1],
    [5, 29],
  ])
    cell = grid.gdfGridAdd(cell, instance, distance, EXTENT, REACH)
  cell = grid.gdfGridSort(cell)
  assert.deepEqual(cell.map(grid.gdfGridInstance), [4, 3, 1, 7])
  assert.ok(cell.every(grid.gdfGridValid))
  // One at the reach or beyond it, either side of the surface, is not kept.
  assert.deepEqual(grid.gdfGridAdd(cell, 11, 30, EXTENT, REACH), cell)
  assert.deepEqual(grid.gdfGridAdd(cell, 12, -40, EXTENT, REACH), cell)
  assert.ok(!grid.gdfGridValid(0xffffffff))
  // A word: the row in 24 bits, the distance in the top 8, from a quarter of the cell’s extent under zero.
  assert.equal(grid.gdfGridPack(5, 0, EXTENT, REACH) >>> 24, 16)
  assert.equal(grid.gdfGridPack(0x1234567, 0, EXTENT, REACH) & 0xffffff, 0x234567)
  assert.equal(grid.gdfGridPack(5, REACH, EXTENT, REACH) >>> 24, 255)
  // The cell’s place in its page: the bits of the three coordinates interleaved, 64 places.
  assert.deepEqual(
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
      [3, 3, 3],
    ].map((c) => grid.gdfGridCellOffset(c as Vec3)),
    [1, 2, 4, 8, 16, 32, 63],
  )
  // The cell of a position: its page, from the page table, and its cell in the page.
  const p: Vec3 = [-100, 20, 60]
  const page = (2 * pages + 2) * pages
  const place = page * 64 + grid.gdfGridCellOffset([2, 1, 3])
  assert.equal(grid.gdfObjectGridCellAt(p, 0, cells.length / 4)[0], place)
  assert.ok(
    grid.gdfObjectGridCellAt(p, 0, place).every((word) => !grid.gdfGridValid(word)),
    'past the grid',
  )
})
