// A page drawn from the float pool reads its results from its geometry's block in that pool, which
// one row deforms for every page (`slotLayout.ts`, `wholePool.ts`), where it read a tail of its own
// slot: the shipped stage and reader, run on both, give every page the same bits, two images on.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { DEFORMATION_COMPUTE_WGSL } from './computeWgsl.ts'
import { DEFORM_VERTEX_WORDS, deformOutputWord } from './slotLayout.ts'
import type { HostAttributes } from '../host/resources.ts'
import { FLAG_DYNAMIC } from '../visibility/types.ts'

type Page = Record<string, number>
const VERTICES = 5,
  REST = VERTICES * 3

/** The stage over `rows` with a float pool of `positions`, a page cache of `indices`, at `image`. */
function stage(positions: Float32Array, indices: Uint32Array, normals: Float32Array) {
  const image = [0, 0, 0, 0]
  const run = shaderRun<{
    deform: (group: number[], lane: number) => void
    pageDeformed: (page: Page, vertex: number, field: number) => number[]
  }>(
    DEFORMATION_COMPUTE_WGSL,
    [
      'deform',
      'storeDeformed',
      'deformTag',
      'deformTagOf',
      'storeTag',
      'pageDeformed',
      'pageHeader',
      'pageHeaderFor',
      'deformWholeCopy',
    ],
    {
      positions,
      indices,
      image,
      pageRestPosition: (page: Page, _h: unknown, v: number) =>
        [0, 1, 2].map((c) => positions[(page.vertexBase + v) * 3 + c]),
      vertN: (base: number, v: number) => [0, 1, 2].map((c) => normals[(base + v) * 3 + c]),
      deformPoint: (_p: Page, _h: unknown, _v: number, rest: number[]) => rest,
      deformNormal: (_p: Page, _h: unknown, _v: number, rest: number[]) => rest,
      clusterPointHeader: () => assert.fail('a float page reads no cluster header'),
      clusterNormal: () => assert.fail('a float page reads no cluster normal'),
    },
  )
  return {
    ...run,
    /** Each row of `rows` deformed at image `frame`, every lane of its group. */
    frame(rows: Page[], frame: number) {
      image[0] = frame
      const scope = { pages: rows, arrayLength: () => rows.length }
      Object.assign(globalThis, scope)
      for (let row = 0; row < rows.length; row++)
        for (let lane = 0; lane < 64; lane++) run.deform([row, 0, 0], lane)
    },
  }
}

test("a float page's block in the float pool holds what its slot's tail held, bit for bit", () => {
  const positions = new Float32Array(REST + 2 + VERTICES * DEFORM_VERTEX_WORDS),
    indices = new Uint32Array(64 + VERTICES * DEFORM_VERTEX_WORDS),
    normals = Float32Array.from({ length: REST }, (_, i) => Math.sin(i + 0.5))
  const move = (t: number) => {
    for (let i = 0; i < REST; i++) positions[i] = Math.cos(i * 0.7 + t) * 3.1
  }
  const row = { flags: FLAG_DYNAMIC, indexCount: 6, vertexBase: 0, deform: 0, selectionIndex: 7 }
  // A tail at word 40 of the page's slot, the page's own row deforming it.
  const tail = { ...row, pageOffset: 0, deformCount: VERTICES, deformOutput: 40 + 2 + 1 }
  // Now: the block after the vertices, two table rows deforming it from vertex 0 and from vertex
  // 3 on (`wholePool.ts`, one pass of the group a row), the page's row reading it.
  const pool = { attributes: {} as HostAttributes },
    word = deformOutputWord({ from: REST + 2, count: VERTICES, pool }, 0)
  const pass = (first: number, count: number) => ({
    ...{ ...row, vertexBase: first, indexCount: count, deformCount: count },
    deformOutput: word + first * DEFORM_VERTEX_WORDS,
  })
  const reader = { ...tail, deformCount: 0, deformOutput: word }
  const gpu = stage(positions, indices, normals)
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
