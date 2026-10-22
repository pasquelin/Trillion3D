import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { pose } from '../../scene/host/prepared/nodes.ts'
import { configurePageWorkers, patientTask, releasePageWorkers } from '../work/host.ts'
import { NodeWorker } from '../../../../../bench/kit/worker.ts'
import { withNodeWorkerShim } from '../../../../../bench/oracles/browser/pageWorkNodeWorker.ts'
import { cellRows, decodeCellFile, rootParentsByNode } from './cellDecode.ts'

const nodes = [
  { parent: null, mesh: 7, matrix: null, translation: [1, 2, 3], rotation: null, scale: [2, 2, 2] },
  { parent: 4, mesh: 9, matrix: null, translation: null, rotation: [0, 1, 0, 0], scale: null },
]
const text = JSON.stringify({ version: 3, nodes })

test('a cell file is read into each node its ranks and the local matrix a host node composes', () => {
  const rows = cellRows(decodeCellFile(new TextEncoder().encode(text).buffer))
  assert.deepEqual([rows.nodes, [...rows.ranks]], [2, [-1, 7, 4, 9]])
  nodes.forEach((node, at) => {
    const host = new Object3D()
    pose(host, node)
    host.updateMatrix()
    const local = [...host.matrix.elements]
    assert.deepEqual([...rows.locals.subarray(16 * at, 16 * at + 16)], local, `node ${at}`)
  })
  const stale = new TextEncoder().encode(JSON.stringify({ version: 1, nodes })).buffer
  assert.throws(() => decodeCellFile(stale), { code: 'INVALID_SCENE_TABLES' })
})

test('a node that names the distances it is drawn at carries them, 0 for none', () => {
  const named = [
    { ...nodes[0], drawDistance: { min: 5, max: 300 } },
    nodes[1],
    { ...nodes[1], drawDistance: { min: 0, max: 40 } },
  ]
  const rows = cellRows(
    decodeCellFile(new TextEncoder().encode(JSON.stringify({ version: 3, nodes: named })).buffer),
  )
  assert.deepEqual([...rows.drawDistances], [5, 300, 0, 0, 0, 40])
})

test('a node that is an instance of an assembly carries the group above the root of each primitive', () => {
  const named = [
    nodes[0],
    // Its part has three primitives: the first and the third have a group above their root.
    { ...nodes[1], rootParents: [[6.5, 1.25, -2, 3, 40], null, [0.5, 0, 0, 0, 9]] },
  ]
  const rows = cellRows(
    decodeCellFile(new TextEncoder().encode(JSON.stringify({ version: 3, nodes: named })).buffer),
  )
  assert.deepEqual(
    [...rows.rootParents!],
    [1, 0, 6.5, 1.25, -2, 3, 40, 1, 2, 0.5, 0, 0, 0, 9],
    'the node, the primitive, the error and the ball',
  )
  const byNode = rootParentsByNode(rows)
  assert.equal(byNode.get(0), undefined)
  assert.deepEqual(byNode.get(1)?.get(0), { error: 6.5, sphere: [1.25, -2, 3, 40] })
  assert.equal(byNode.get(1)?.get(1), undefined, 'no group replaces the second primitive')
  assert.deepEqual(byNode.get(1)?.get(2), { error: 0.5, sphere: [0, 0, 0, 9] })
  // A cell with none carries no float of it.
  assert.equal(
    cellRows(decodeCellFile(new TextEncoder().encode(text).buffer)).rootParents!.length,
    0,
  )
})

test('a cell file is parsed in a worker of the page worker pool, never on the main thread', () =>
  withNodeWorkerShim(NodeWorker, async () => {
    releasePageWorkers()
    configurePageWorkers(1)
    const parse = JSON.parse
    let parsed = 0
    JSON.parse = (...args: Parameters<typeof parse>) => {
      if (args[0] === text) parsed++
      return parse(...args)
    }
    let answer
    try {
      answer = await patientTask('cells', new TextEncoder().encode(text))
    } finally {
      JSON.parse = parse
      releasePageWorkers()
    }
    assert.equal(parsed, 0, 'the main thread parsed the cell')
    assert.ok(answer.ok && answer.cells, JSON.stringify(answer))
    const here = decodeCellFile(new TextEncoder().encode(text).buffer)
    assert.deepEqual(new Float64Array(answer.cells.locals), new Float64Array(here.locals))
  }))

test('a cell file the worker refuses answers with its code and names its file', () =>
  withNodeWorkerShim(NodeWorker, async () => {
    releasePageWorkers()
    configurePageWorkers(1)
    const stale = new TextEncoder().encode(JSON.stringify({ version: 1, nodes }))
    let answer
    try {
      answer = await patientTask('cells', stale, 'https://cache.test/key/scene-cell-3.json')
    } finally {
      releasePageWorkers()
    }
    assert.ok(!answer.ok, 'refused')
    assert.equal(answer.refusal, 'INVALID_SCENE_TABLES')
    assert.match(answer.message, /scene-cell-3\.json/)
  }))
