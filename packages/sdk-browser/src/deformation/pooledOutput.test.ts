// A page drawn from the float pool reads its results from its geometry's block in that pool, which
// one row deforms for every page (`outputs.ts`, `pooledRows.ts`), where it read a tail of its own
// slot: the shipped stage and reader, run on both, give every page the same bits, two images on.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { DEFORMATION_COMPUTE_WGSL } from './computeWgsl.ts'
import { deformOutputWord } from './outputs.ts'
import { DEFORM_VERTEX_WORDS, DEFORMED_FIELD } from './vertexWords.ts'
import { FLAG_DYNAMIC, FLAG_HAS_TANGENT } from '../visibility/types.ts'
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'

type Page = Record<string, number>
const VERTICES = 5,
  REST = VERTICES * 3

/** The stage over `rows` with a float pool of `positions`, a page cache of `indices`, at `image`. */
function stage(
  positions: Float32Array,
  indices: Uint32Array,
  [normals, tangents]: [Float32Array, Float32Array],
) {
  const image = [0, 0, 0, 0]
  const run = shaderRun<{
    deform: (group: number[], lane: number, n: number[]) => void
    pageDeformed: (page: Page, vertex: number, field: number) => number[]
  }>(
    DEFORMATION_COMPUTE_WGSL,
    [
      'deform',
      'flatIndex',
      'storeDeformed',
      'deformTag',
      'deformTagOf',
      'storeTag',
      'pageDeformed',
      'pageHeader',
      'pageHeaderFor',
    ],
    {
      positions,
      indices,
      image,
      pageRestPosition: (page: Page, _h: unknown, v: number) =>
        [0, 1, 2].map((c) => positions[(page.vertexBase + v) * 3 + c]),
      vertN: (base: number, v: number) => [0, 1, 2].map((c) => normals[(base + v) * 3 + c]),
      vertT: (base: number, v: number) => [0, 1, 2, 3].map((c) => tangents[(base + v) * 4 + c]),
      deformVertex: (
        _p: Page,
        _h: unknown,
        _v: number,
        rest: number[],
        normal: number[],
        tangent: number[],
      ) => ({ p: rest, n: normal, t: tangent.map((x) => -x) }),
      clusterPointHeader: () => assert.fail('a float page reads no cluster header'),
      clusterNormal: () => assert.fail('a float page reads no cluster normal'),
      clusterTangent: () => assert.fail('a float page reads no cluster tangent'),
    },
  )
  return {
    ...run,
    /** Each row of `rows` deformed at image `frame`, every lane of its group. */
    frame(rows: Page[], frame: number) {
      image[0] = frame
      image[1] = rows.length
      const scope = { pages: rows, arrayLength: () => rows.length }
      Object.assign(globalThis, scope)
      for (let row = 0; row < rows.length; row++)
        for (let lane = 0; lane < 64; lane++) run.deform([row, 0, 0], lane, [rows.length, 1, 1])
    },
  }
}

test("a float page's block in the float pool holds what its slot's tail held, bit for bit", () => {
  const positions = new Float32Array(REST + 2 + 2 * (VERTICES * DEFORM_VERTEX_WORDS + 2)),
    indices = new Uint32Array(64 + VERTICES * DEFORM_VERTEX_WORDS),
    normals = Float32Array.from({ length: REST }, (_, i) => Math.sin(i + 0.5))
  const move = (t: number) => {
    for (let i = 0; i < REST; i++) positions[i] = Math.cos(i * 0.7 + t) * 3.1
  }
  const row = { flags: FLAG_DYNAMIC, indexCount: 6, vertexBase: 0, deform: 0, selectionIndex: 7 }
  // A page's own results, after the block's, its own row deforming them.
  const own = REST + 2 + VERTICES * DEFORM_VERTEX_WORDS + 2
  const tail = { ...row, pageOffset: 0, deformCount: VERTICES, deformOutput: own + 1 }
  // Now: the block after the vertices, two table rows deforming it from vertex 0 and from vertex
  // 3 on (`pooledRows.ts`, one pass of the group a row), the page's row reading it.
  const pool = { attributes: {} as Geometry['attributes'] },
    word = deformOutputWord({ from: REST + 2, count: VERTICES, pool })
  const pass = (first: number, count: number) => ({
    ...{ ...row, vertexBase: first, indexCount: count, deformCount: count },
    deformOutput: word + first * DEFORM_VERTEX_WORDS,
  })
  const reader = { ...tail, deformCount: 0, deformOutput: word }
  const tangents = Float32Array.from({ length: VERTICES * 4 }, (_, i) => Math.cos(i + 0.25))
  const gpu = stage(positions, indices, [normals, tangents])
  for (const frame of [1, 2, 3]) {
    move(frame)
    gpu.frame([tail, pass(0, 3), pass(3, VERTICES - 3)], frame)
    for (let v = 0; v < VERTICES; v++)
      for (const field of [0, 3, 6]) {
        const before = new Float32Array(gpu.pageDeformed(tail, v, field)),
          now = new Float32Array(gpu.pageDeformed(reader, v, field))
        assert.deepEqual(now, before, `image ${frame}, vertex ${v}, field ${field}`)
      }
  }
  // The previous position is the last image's, as the tail kept it.
  assert.notDeepEqual(gpu.pageDeformed(reader, 0, 3), gpu.pageDeformed(reader, 0, 0))
})

test('a row whose page stores tangents has them deformed beside its normals, and a row without leaves the field be', () => {
  const positions = new Float32Array(REST + 2 + VERTICES * DEFORM_VERTEX_WORDS + 2),
    indices = new Uint32Array(64),
    normals = Float32Array.from({ length: REST }, (_, i) => Math.sin(i + 0.5)),
    tangents = Float32Array.from({ length: VERTICES * 4 }, (_, i) => Math.cos(i + 0.25))
  positions.fill(7, REST)
  const at = REST + 2
  const row = (flags: number) => ({
    ...{ flags, indexCount: 6, vertexBase: 0, deform: 0, selectionIndex: 3, pageOffset: 0 },
    ...{ deformCount: VERTICES, deformOutput: at + 1 },
  })
  const gpu = stage(positions, indices, [normals, tangents])
  const field = (v: number) => at + v * DEFORM_VERTEX_WORDS + DEFORMED_FIELD.tangent
  gpu.frame([row(FLAG_DYNAMIC)], 1)
  assert.deepEqual(
    Array.from({ length: VERTICES }, (_, v) => positions[field(v)]),
    new Array(VERTICES).fill(7),
    'a row without stored tangents writes none',
  )
  gpu.frame([row(FLAG_DYNAMIC | FLAG_HAS_TANGENT)], 2)
  for (let v = 0; v < VERTICES; v++)
    assert.deepEqual(
      Array.from(positions.subarray(field(v), field(v) + 3)),
      [0, 1, 2].map((c) => Math.fround(-tangents[v * 4 + c])),
      `vertex ${v}`,
    )
  // The tangent is three floats: what follows it is the next vertex's tags (its owner's, here the
  // row's selection index plus one).
  assert.equal(positions[field(0) + 3], 4)
})
