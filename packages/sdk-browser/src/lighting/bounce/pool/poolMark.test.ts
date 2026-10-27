// The mark of a point (`pool/poolMarkWgsl.ts`) run as JavaScript: which cells a surface point marks, and the bindings of the passes that call it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { createBounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { markedCells } from './pool.fixture.ts'
import { MARK_IMAGE_BINDINGS, MARK_PROBES_BINDINGS, poolShapeOf } from './poolLayout.ts'
import { MARK_IMAGE_SHADER, MARK_PROBES_SHADER, markPoint } from './poolMarkWgsl.ts'

const MARK_AT = wgslProgram(
  `@group(0) @binding(1) var<uniform> bounce:BounceGrid;
fn markAt(P:vec3f,dither:f32){markPointBiased(P,dither,0u);}`,
  [markPoint(0)],
)

const MARK_CELL = wgslProgram(
  `@group(0) @binding(1) var<uniform> bounce:BounceGrid;
fn markOne(level:u32,cell:vec3i){markCell(level,cell);}`,
  [markPoint(0)],
)

/** The levels centred on the eye `[5, 5, 5]`, the words the marks are written into and the bounce grid the kernels read them as. */
function eyeCascades() {
  const cascades = createBounceCascades([0, 0, 0, 10, 10, 10])
  cascades.follow([5, 5, 5])
  const marks = new Uint32Array(poolShapeOf(cascades).markWords)
  const bounce = {
    counts: [cascades.size, cascades.levels.length, cascades.cells, cascades.probes],
    frame: [1, 0, 1, 0],
    eye: [5, 5, 5, 0],
    levels: cascades.levels.map(({ base, spacing }) => ({ base: [...base], spacing })),
  }
  return { cascades, marks, bounce }
}

/** The cells `point` marks over levels centred on the eye `[5, 5, 5]`, as the levels hold them. */
function marked(point: number[], dither = 0) {
  const { cascades, marks, bounce } = eyeCascades()
  shaderRun<{ markAt: (p: number[], dither: number) => void }>(MARK_AT, ['markAt'], {
    bounce,
    marks,
  }).markAt(point, dither)
  return { cascades, cells: markedCells(cascades, marks) }
}

test('a point marks the eight cells round it, the point itself: the corner is the cell its position falls in, the probes standing on the lattice of the cells’ sides', () => {
  const { spacing } = marked([5, 5, 5]).cascades.levels[0]
  // Nine tenths of the way from one probe to the next: a point pushed off its surface by a bias would have marked the next cell over.
  const point = [5, 5, 5].map((v) => (Math.floor(v / spacing) + 0.9) * spacing)
  const { cells } = marked(point)
  const corner = point.map((v) => Math.floor(v / spacing))
  assert.equal(cells.length, 8)
  assert.ok(cells.every(({ level }) => level === 0))
  const expected = new Set<string>()
  for (let index = 0; index < 8; index++)
    expected.add(corner.map((c, axis) => c + ((index >> axis) & 1)).join())
  assert.deepEqual(new Set(cells.map(({ cell }) => cell.join())), expected)
})

test('the finest level whose share of the answer is above zero marks: a point on the edge of a level marks the next', () => {
  const { base, spacing } = marked([5, 5, 5]).cascades.levels[0]
  const edge = (cells: number) => [(base[0] + cells) * spacing, 5, 5]
  // Half a cell inside the first probe: the share is above zero, the level answers.
  assert.ok(marked(edge(0.5)).cells.every(({ level }) => level === 0))
  // On the level's first probe the share is zero: the next level marks.
  const outside = marked(edge(0)).cells
  assert.equal(outside.length, 8)
  assert.ok(outside.every(({ level }) => level === 1))
  // A point past every level marks nothing.
  assert.equal(marked([5000, 5, 5]).cells.length, 0)
})

test('a dither above the share of a level’s answer leaves the mark to the next level', () => {
  const { base, spacing } = marked([5, 5, 5]).cascades.levels[0]
  // Half a cell inside the first probe: the level answers with half its share.
  const edge = [(base[0] + 0.5) * spacing, 5, 5]
  assert.ok(marked(edge, 0.4).cells.every(({ level }) => level === 0))
  assert.ok(marked(edge, 0.6).cells.every(({ level }) => level === 1))
})

test('the passes that mark read the surface’s depth alone: no normal binding, and every binding declared', () => {
  for (const [name, code, bindings] of [
    ['image', MARK_IMAGE_SHADER, MARK_IMAGE_BINDINGS],
    ['probes', MARK_PROBES_SHADER, MARK_PROBES_BINDINGS],
  ] as const) {
    assertProgramAssembles(code, undefined, name)
    const declared = [...code.matchAll(/@group\(0\)\s*@binding\((\d+)\)/g)].map((m) => +m[1])
    assert.deepEqual(
      declared.sort((a, b) => a - b),
      Object.values(bindings).sort((a, b) => a - b),
      name,
    )
    // No normal is bound, and no function of the marks takes one: the view's own helpers (the eye's direction) may normalise.
    assert.ok(!/sceneNormals|probeNormal|\bN:vec3f/.test(code), `${name} reads no normal`)
  }
})

test('a cell the level does not hold is left unmarked: the cube’s own cells mark, the cells just past its edges do not', () => {
  const { cascades, marks, bounce } = eyeCascades()
  const { markOne } = shaderRun<{ markOne: (level: number, cell: number[]) => void }>(
    MARK_CELL,
    ['markOne'],
    { bounce, marks },
  )
  const base = [...cascades.levels[0].base]
  const last = base.map((b) => b + cascades.size - 1)
  markOne(
    0,
    base.map((b) => b - 1),
  )
  markOne(
    0,
    last.map((b) => b + 1),
  )
  markOne(0, [base[0], base[1], last[2] + 1])
  assert.equal(markedCells(cascades, marks).length, 0)
  markOne(0, base)
  markOne(0, last)
  assert.deepEqual(
    markedCells(cascades, marks)
      .map(({ cell }) => cell.join())
      .sort(),
    [last.join(), base.join()].sort(),
  )
})
