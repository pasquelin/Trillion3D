// The resolve reads its row's normal matrix from the frame cache (`shadeCacheWgsl.ts`) instead of
// composing it per pixel, for a row a pixel reads. This runs the shipped rows pass and the shipped
// read, in binary32, on worlds of every kind the inverse transpose separates — regular, mirrored,
// sheared, flattened to rank 2 or 1, tiny, huge — and asks of each row the very bits the pixel
// composes without it; a row no pixel reads is not composed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts'
import { builtins } from '../../texture/shaderRunBuiltins.fixture.ts'
import { wgslConstants } from '../../texture/shaderRule.fixture.ts'
import { F32_SCOPE } from '../../lighting/shaderRunF32.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { SHADE_CACHE_SHADER, shadeCacheReadWgsl } from './shadeCacheWgsl.ts'

type V = number[]
type Frame = { invT: { adj: V[]; scale: number; regular: boolean }; positive: boolean }
const cross = F32_SCOPE.cross as (a: V, b: V) => V,
  dot = F32_SCOPE.dot as (a: V, b: V) => number
const READ = wgslModule(shadeCacheReadWgsl(0))
const words: number[] = []
const scope = {
  ...F32_SCOPE,
  ...wgslConstants(READ),
  SHADE_CACHE: true,
  shadeCache: words,
  // WGSL's 3×3 by its columns, and its determinant, in binary32.
  mat3x3f: (...columns: V[]) => columns,
  determinant: (m: V[]) => dot(m[0], cross(m[1], m[2])),
  InvT3: (adj: V[], scale: number, regular: boolean) => ({ adj, scale, regular }),
  RowFrame: (invT: Frame['invT'], positive: boolean) => ({ invT, positive }),
  bitcast_vec3f: builtins.bitcast_f32,
}
const PIXEL = shaderRun<{
  rowFrame: (row: number, world: Mat) => Frame
  composeRowFrame: (world: Mat) => Frame
}>(
  READ,
  [
    'rowFrame',
    'cacheVec3',
    'composeRowFrame',
    'invTranspose3Prep',
    'absoluteSum3',
    'isFiniteScale',
    'worldMatrix3',
    'windingKept',
  ],
  scope,
)

/** The worlds, column-major, translation last. */
const WORLDS = [
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  [1.5, 0, 0.2, 0, 0, 0.8, 0, 0, 0, 0.3, 1.2, 0, 0.2, -0.1, 0.5, 1],
  [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 0, 0, 1],
  // Flattened: rank 2, then rank 1 — the adjugate carries the face, then nothing.
  [0.6, 0.8, 0, 0, -0.8, 0.6, 0, 0, 0, 0, 0, 0, 3, 1, 2, 1],
  [1, 2, 3, 0, 2, 4, 6, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1e-8, 0, 0, 0, 0, 2e-8, 0, 0, 0, 0, 3e-8, 0, 0, 0, 0, 1],
  [3e7, 1e7, 0, 0, 0, 2e7, 5e6, 0, 1e6, 0, 4e7, 0, 9, 9, 9, 1],
  [0.31, -0.72, 0.11, 0, 0.54, 0.27, -0.93, 0, 0.66, 0.41, 0.38, 0, -4, 7, 2, 1],
].map((m) => new Mat(m.map(Math.fround)))

/** A frame's floats as their bits, and its flags: equal bit for bit, not to a tolerance. */
const bits = (frame: Frame) => [
  ...new Uint32Array(new Float32Array([...frame.invT.adj.flat(), frame.invT.scale]).buffer),
  frame.invT.regular,
  frame.positive,
]

test('each row a pixel reads reads the frame its pixels compose, bit for bit', () => {
  const { ROW_RECORDS, ROW_RECORD_WORDS, ROW_MARK_WORDS, PLANE_WORDS } =
    wgslConstants(SHADE_CACHE_SHADER)
  // Each world's row read — a lone triangle (plane A) or one read twice (B, past a capacity of
  // none) —, and one row more no pixel reads.
  const rows = WORLDS.length + 1,
    marks = ROW_RECORDS + rows * ROW_RECORD_WORDS
  const record = (row: number) =>
    words.slice(ROW_RECORDS + row * ROW_RECORD_WORDS, ROW_RECORDS + (row + 1) * ROW_RECORD_WORDS)
  words.length = 0
  words.push(0, rows, 0, 0, ...new Array(rows * (ROW_RECORD_WORDS + ROW_MARK_WORDS)).fill(0))
  WORLDS.forEach((_, row) => (words[marks + row * ROW_MARK_WORDS + (row % 2) * PLANE_WORDS] = 1))
  const pass = shaderRun<{ shade_rows: (g: V, n: V) => void }>(
    SHADE_CACHE_SHADER,
    'shade_rows storeRowFrame storeVec3 storeWord composeRowFrame invTranspose3Prep absoluteSum3 isFiniteScale worldMatrix3 windingKept rowMarks flatIndex'.split(
      ' ',
    ),
    {
      ...scope,
      ...wgslConstants(SHADE_CACHE_SHADER),
      pages: [...WORLDS, WORLDS[0]].map((world) => ({ world })),
    },
  )
  // A lane past the rows writes nothing.
  for (let lane = 0; lane <= rows; lane++) pass.shade_rows([lane, 0, 0], [1, 1, 1])
  assert.equal(words.length, marks + rows * ROW_MARK_WORDS)
  WORLDS.forEach((world, row) =>
    assert.deepEqual(
      bits(PIXEL.rowFrame(row, world)),
      bits(PIXEL.composeRowFrame(world)),
      `${row}`,
    ),
  )
  // The row no pixel reads is composed by no pass.
  assert.equal(record(WORLDS.length).some(Boolean), false)
  // The worlds cover each case the frame separates.
  const kinds = WORLDS.map((world) => PIXEL.composeRowFrame(world))
  assert.ok(kinds.some((k) => !k.invT.regular) && kinds.some((k) => k.invT.regular))
  assert.ok(kinds.some((k) => !k.positive) && kinds.some((k) => k.positive))
})

test('a row past the frames the pass laid is composed by its pixel', () => {
  words.length = 0
  words.push(0, 1, 0, 0, ...new Array(16).fill(0))
  // Row 1 has no frame: its words would read as a zero matrix, its pixel composes instead.
  assert.deepEqual(bits(PIXEL.rowFrame(1, WORLDS[1])), bits(PIXEL.composeRowFrame(WORLDS[1])))
  assert.notDeepEqual(bits(PIXEL.rowFrame(0, WORLDS[1])), bits(PIXEL.composeRowFrame(WORLDS[1])))
})
