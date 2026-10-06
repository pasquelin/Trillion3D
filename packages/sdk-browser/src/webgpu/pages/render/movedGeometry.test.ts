// #573 on WebGPU: a dynamic geometry's rewrite hands its roots how far a vertex lies from where its
// pages are bounded, and each page's box where its vertices are (`noteRewritten`). Its roots hold
// that reach as a deformation's — the GPU cut by its mark —, this rewrite's, not the farthest ever;
// each page's record holds its box (`PageRec.moved`), which its row's sphere and corners read, and
// only the rows whose bounds changed travel again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { noteRewritten } from './movedGeometry.ts'
import { runtime, scene, selectionRoot } from '../../core/transformShear.fixture.ts'
import { markReach } from '../../../deformation/halfFloat.ts'
import { growClusterBox } from '../../shadow/spheres.ts'
import { ROW_LOD_FLOATS, writeRowLod } from '../../shadow/rowLodWords.ts'
import type { ClusterRoot, PageRec } from '../../../page/selection/types.ts'

const box = (...values: number[]) => Float64Array.from(values)
const EMPTY = box(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity)

/** Dynamic roots drawing one geometry, each page bounded by a unit box at rest along x, `shared`
 *  roots on the same records; their rows, page by page, the marked ones in `marked`. */
function dynamicRoots(pages = 1, shared = 1, transparent = false) {
  const { source, mesh, worlds } = scene('sea'),
    attributes = {}
  const records = Array.from(
    { length: pages },
    (_, id) =>
      ({
        id,
        sourceMesh: mesh,
        attributes,
        transparent,
        min: [id, 0, 0],
        max: [id + 1, 1, 1],
      }) as unknown as PageRec,
  )
  const roots = Array.from({ length: shared }, (_, n) =>
    Object.assign(selectionRoot(mesh, [0, 0, 0, pages, 1, 1], worlds), {
      pages: records,
      packedBase: n * pages,
    }),
  )
  const { rt, run, motions, layout } = runtime(source, roots, worlds)
  const rows = pages * shared,
    marked: number[] = [],
    each = Int32Array.from({ length: rows }, (_, i) => i)
  Object.assign(layout.rows, {
    pageTableFloats: new Float32Array(rows * 64),
    rowOfPage: each,
    blendRowOf: each,
    packedPageIndex: each,
    packedCount: rows,
    markRowWords: (row: number) => void marked.push(row),
  })
  rt.lights.mobility.ensure(shared, shared, (rank) => roots[rank].world.elements)
  const marks: number[] = []
  run.gpuSelection = { markWorld: (_: number, mark: number) => marks.push(mark) } as never
  return { rt, roots, records, attributes, marks, motions, marked }
}

test("a rewrite's reach is held by its roots and marked for the GPU cut: this rewrite's", () => {
  const { rt, roots, attributes, marks, motions } = dynamicRoots()
  noteRewritten(rt, attributes, box(0, 0, 0, 1, 1, 1.5), 0.5)
  assert.equal(roots[0].reach, 0.5)
  assert.deepEqual(marks, [markReach(0, 0.5)], 'the GPU cut grows its bounds by it')
  assert.equal(motions.length, 1, 'the moved box stales its shadow pages')
  noteRewritten(rt, attributes, box(0, 0, 0, 1, 1, 1.25), 0.25)
  assert.equal(roots[0].reach, 0.25, 'the vertices came back: the reach with them')
  assert.deepEqual(marks, [markReach(0, 0.5), markReach(0, 0.25)])
  noteRewritten(rt, {}, box(0, 0, 0, 1, 1, 9), 9)
  assert.equal(roots[0].reach, 0.25, 'another geometry moves none of its roots')
})

test("a new session's roots hear the reach and boxes alone: an empty box moves and stales nothing", () => {
  const { rt, roots, records, attributes, marks, motions } = dynamicRoots()
  noteRewritten(rt, attributes, EMPTY, 0.75, box(0, 0, 0.75, 1, 1, 1.75))
  assert.equal(roots[0].reach, 0.75)
  assert.deepEqual(records[0].moved, { min: [0, 0, 0.75], max: [1, 1, 1.75] })
  assert.equal(marks.length, 1)
  assert.equal(motions.length, 0, 'no box declared')
  assert.equal(rt.lights.mobility.moves(0), false, 'the root is not moved by hearing it')
})

test('only the rows and transparent entries whose box moved travel again, on every placement', () => {
  const { rt, records, attributes, marked } = dynamicRoots(3, 2, true)
  const moved = { from: Infinity, to: -1 }
  Object.assign(rt.blendState, {
    occlusionEpoch: 7,
    occlusionMoved: moved,
    table: { entryOfPage: Int32Array.of(10, 11, 12, 20, 21, 22) },
  })
  const boxes = box(0, 0, 0, 1, 1, 1, 1, 0, 0, 2, 1, 1, 2, 0, 0, 3, 1, 1)
  noteRewritten(rt, attributes, EMPTY, 0, boxes)
  assert.deepEqual(marked, [0, 1, 2, 3, 4, 5], 'first heard: every row')
  assert.deepEqual(moved, { from: 10, to: 22 })
  ;[marked.length, moved.from, moved.to] = [0, Infinity, -1]
  // Page 1 lifted by a quarter: its box moves, the reach with it, which no row reads.
  boxes.set([1, 0, 0.25, 2, 1, 1.25], 6)
  noteRewritten(rt, attributes, box(1, 0, 0, 2, 1, 1.25), 0.25, boxes)
  assert.deepEqual(marked, [1, 4], "page 1's row on each placement, no other")
  assert.deepEqual(records[1].moved, { min: [1, 0, 0.25], max: [2, 1, 1.25] })
  assert.deepEqual(moved, { from: 11, to: 21 }, 'its transparent entries alone are sent again')
  assert.equal(rt.blendState.occlusionEpoch, 7, 'the whole transparent table is not')
  marked.length = 0
  noteRewritten(rt, attributes, EMPTY, 0.25, boxes)
  assert.deepEqual(marked, [], 'nothing moved, nothing travels')
})

test("a moved row's level-of-detail sphere is its box's, which no reach grows", () => {
  const { roots, records } = dynamicRoots()
  Object.assign(records[0], { sphere: [0.5, 0.5, 0.5, 0.9], lodError: 0, level: 0 })
  records[0].moved = { min: [0, 0, 6], max: [1, 1, 7] }
  roots[0].reach = 6
  const out = new Float32Array(ROW_LOD_FLOATS)
  writeRowLod(out, 0, records[0], roots[0])
  const e = roots[0].world.elements
  assert.equal(out[0] + out[8], 0.5 + e[12])
  assert.equal(out[2] + out[10], 6.5 + e[14], 'centred where its vertices are')
  assert.equal(out[16], Math.fround(Math.sqrt(3) / 2), 'its box’s radius, no reach')
})

test("a row's shadow sphere is its page's box where its vertices are, not its rest box and reach", () => {
  const { rt, roots, records, attributes } = dynamicRoots()
  // Every vertex lifted by six: the reach is six, the box a unit box six higher.
  noteRewritten(rt, attributes, box(0, 0, 0, 1, 1, 7), 6, box(0, 0, 6, 1, 1, 7))
  const sphereBox = box(...EMPTY)
  growClusterBox(records[0], roots, sphereBox, 0)
  const z = roots[0].world.elements[14]
  for (const corner of [0, 1])
    for (let a = 0; a < 3; a++) {
      const at = (a === 2 ? 6 : 0) + corner + roots[0].world.elements[12 + a]
      assert.ok(at >= sphereBox[a] && at <= sphereBox[a + 3], `axis ${a} at ${at}`)
    }
  // The unit box's sphere, √3 across: not the rest box grown by six on every side.
  assert.ok(sphereBox[5] - sphereBox[2] < 2, `${sphereBox[2] - z} to ${sphereBox[5] - z}`)
  assert.ok(sphereBox[2] - z > 4, 'nowhere near where the page rested')
})

test('a row without a moved box — a deformed placement — grows by its root reach', () => {
  const { roots, records } = dynamicRoots()
  ;(roots[0] as ClusterRoot<PageRec>).reach = 0.5
  const sphereBox = box(...EMPTY)
  growClusterBox(records[0], roots, sphereBox, 0)
  const e = roots[0].world.elements
  for (const corner of [-0.5, 1.5])
    for (let a = 0; a < 3; a++) {
      const at = corner + e[12 + a]
      assert.ok(at >= sphereBox[a] && at <= sphereBox[a + 3], `axis ${a} at ${at}`)
    }
})
