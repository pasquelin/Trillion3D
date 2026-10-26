// On WebGPU, a dynamic geometry's rewrite hands its roots how far a vertex lies from where its
// pages are bounded, and each page's box where its vertices are (`noteRewritten`). Its roots hold
// that reach as a deformation's — the GPU cut by its mark —, this rewrite's, not the farthest ever;
// each page's record holds its box (`PageRec.moved`), which its shadow sphere and its transparent
// entries' corners read, and only the entries whose bounds changed travel again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { noteRewritten } from './movedGeometry.ts'
import { runtime, scene, selectionRoot } from '../../gpu/core/transformShear.fixture.ts'
import { rootMark } from '../../deformation/halfFloat.ts'
import { growClusterBox } from '../../lighting/shadows/casters/spheres.ts'
import type { ClusterRoot, PageRec } from '../../geometry/selection/types.ts'

const box = (...values: number[]) => Float64Array.from(values)
const EMPTY = box(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity)

/** Dynamic roots drawing one geometry, each page bounded by a unit box at rest along x, `shared`
 *  roots on the same records. */
function dynamicRoots(pages = 1, shared = 1, transparent = false) {
  const { source, mesh, worlds } = scene('sea'),
    attributes = {}
  const records = Array.from(
    { length: pages },
    (_, id) =>
      ({
        id,
        drawSource: { node: mesh },
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
  const { rt, run, motions } = runtime(source, roots, worlds)
  rt.lights.mobility.ensure(shared, (rank) => roots[rank].world.elements)
  const marks: number[] = []
  run.gpuSelection = { markWorld: (_: number, mark: number) => marks.push(mark) } as never
  return { rt, roots, records, attributes, marks, motions }
}

test("a rewrite's reach is held by its roots and marked for the GPU cut: this rewrite's", () => {
  const { rt, roots, attributes, marks, motions } = dynamicRoots()
  noteRewritten(rt, attributes, box(0, 0, 0, 1, 1, 1.5), 0.5)
  assert.equal(roots[0].reach, 0.5)
  assert.deepEqual(marks, [rootMark({ mark: 0, reach: 0.5 })], 'the GPU cut grows its bounds by it')
  assert.equal(motions.length, 1, 'the moved box stales its shadow pages')
  noteRewritten(rt, attributes, box(0, 0, 0, 1, 1, 1.25), 0.25)
  assert.equal(roots[0].reach, 0.25, 'the vertices came back: the reach with them')
  assert.deepEqual(marks, [rootMark({ mark: 0, reach: 0.5 }), rootMark({ mark: 0, reach: 0.25 })])
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

test('only the transparent entries whose box moved travel again, on every placement', () => {
  const { rt, records, attributes } = dynamicRoots(3, 2, true)
  const moved = { from: Infinity, to: -1 }
  Object.assign(rt.blendState, {
    occlusionEpoch: 7,
    occlusionMoved: moved,
    table: { entryOf: (page: number) => [10, 11, 12, 20, 21, 22][page] ?? -1 },
  })
  const boxes = box(0, 0, 0, 1, 1, 1, 1, 0, 0, 2, 1, 1, 2, 0, 0, 3, 1, 1)
  noteRewritten(rt, attributes, EMPTY, 0, boxes)
  assert.deepEqual(moved, { from: 10, to: 22 })
  ;[moved.from, moved.to] = [Infinity, -1]
  // Page 1 lifted by a quarter: its box moves, the reach with it.
  boxes.set([1, 0, 0.25, 2, 1, 1.25], 6)
  noteRewritten(rt, attributes, box(1, 0, 0, 2, 1, 1.25), 0.25, boxes)
  assert.deepEqual(records[1].moved, { min: [1, 0, 0.25], max: [2, 1, 1.25] })
  assert.deepEqual(moved, { from: 11, to: 21 }, 'its transparent entries alone are sent again')
  assert.equal(rt.blendState.occlusionEpoch, 7, 'the whole transparent table is not')
  moved.from = Infinity
  moved.to = -1
  noteRewritten(rt, attributes, EMPTY, 0.25, boxes)
  assert.deepEqual(moved, { from: Infinity, to: -1 }, 'nothing moved, nothing travels')
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
