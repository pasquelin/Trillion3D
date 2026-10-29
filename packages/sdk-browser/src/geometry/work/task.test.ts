// Batch H2: the contract's shared task — the work run as-is by the worker and by the fallback
// on the main thread. Hostile input: a cell file too short to read.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PAGE_TASK_PROTOCOL,
  type PageTaskRequest,
} from '../../../../sdk-core/src/page/taskContracts.ts'
import { runPageTask } from './task.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { drawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts'
import { packDrawn } from '../runtime/runtimePack.ts'
import '../../wasm/sdkWasm.fixture.ts'

function requete(overrides: Partial<PageTaskRequest>): PageTaskRequest {
  return {
    protocol: PAGE_TASK_PROTOCOL,
    id: 1,
    op: 'cells',
    source: new ArrayBuffer(0),
    ...overrides,
  }
}

test('an arbitrary request identifier comes back unchanged in every form of answer', async () => {
  const cell = JSON.stringify({ version: 4, nodes: [] })
  const { answer: ok } = await runPageTask(
    requete({ op: 'cells', source: new TextEncoder().encode(cell).buffer, id: 777 }),
  )
  assert.equal(ok.ok, true, 'an empty cell file is read')
  assert.equal(ok.id, 777)
  const { answer: refusals } = await runPageTask(
    requete({ op: 'cells', source: new ArrayBuffer(2), id: 778, name: 'short.cells' }),
  )
  assert.equal(refusals.ok, false, 'two bytes hold no cell file')
  assert.equal(refusals.id, 778)
})

test("a cut's answer carries the tree of its rays, its buffers transferred with the pages'", async () => {
  const drawn = drawnTriangles(geometry.sphere(1, 16, 8), 'triangles')!
  const { answer, transfer } = await runPageTask(
    requete({ op: 'cut', source: packDrawn(drawn, false) }),
  )
  assert.equal(answer.ok, true)
  const tree = answer.ok ? answer.cut?.rayTracing : undefined
  assert.ok(tree, 'a cut of faces holds a tree')
  assert.ok(transfer.includes(tree.nodes.buffer as ArrayBuffer))
  assert.ok(transfer.includes(tree.triangles.buffer as ArrayBuffer))
})

test('a distance field is built in two worker tasks with the device between them, and is the field the one thread builds', async () => {
  const { prepareDistanceField, finishDistanceField } =
    await import('../../../../sdk-core/src/lighting/distanceFieldBuild.ts')
  const { soupIndices } = await import('../../../../sdk-core/src/lighting/rayTracingTree.ts')
  const { doubtfulArrays, voxelJobOf } =
    await import('../../../../sdk-core/src/lighting/distanceFieldGpu.ts')
  const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1])
  const source = () => positions.slice().buffer
  const planned = await runPageTask(
    requete({ op: 'fieldPlan', source: source(), field: { doubleSided: true } }),
  )
  assert.equal(planned.answer.ok, true)
  const plan = planned.answer.ok ? planned.answer.fieldPlan : undefined
  assert.ok(plan && plan.touched.length > 0, 'bricks are named for the device')
  assert.ok(planned.transfer.includes(plan.words.buffer), 'the scene words are transferred')
  // The device gives every voxel up: the second task measures them all.
  const job = voxelJobOf(plan)
  const voxels = new Uint8Array(job.count)
  const doubtful = Array.from({ length: job.count }, (_, at) => ({ at }))
  const { at, settled } = doubtfulArrays(doubtful)
  const finished = await runPageTask(
    requete({
      op: 'fieldFinish',
      source: source(),
      field: {
        doubleSided: true,
        mesh: -3,
        voxels: voxels.buffer,
        doubtfulAt: at.buffer,
        doubtfulSettled: settled.buffer,
      },
    }),
  )
  const field = finished.answer.ok ? finished.answer.distanceField : undefined
  assert.ok(field && field.mesh === -3 && field.mips.length === 3)
  const indices = soupIndices(positions)
  const alone = finishDistanceField(
    -3,
    positions,
    indices,
    { voxels: new Uint8Array(job.count), doubtful },
    { doubleSided: true },
  )!
  assert.deepEqual(Array.from(field.mips[0].bricks), Array.from(alone.mips[0].bricks))
  assert.equal(
    prepareDistanceField(positions, indices, { doubleSided: true })!.touched.length,
    plan.touched.length,
  )
  const none = await runPageTask(
    requete({ op: 'fieldPlan', source: new ArrayBuffer(0), field: { doubleSided: false } }),
  )
  assert.equal(none.answer.ok && none.answer.fieldPlan, null, 'no triangle, no plan')
})
