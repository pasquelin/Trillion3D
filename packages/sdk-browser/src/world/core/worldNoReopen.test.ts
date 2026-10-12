// No content change reaches a reopen. The causes of a reopen are enumerated — a lost device, an
// option the engine cannot take in place — and the type holds no other; a world whose scene gains
// meshes of new geometries and materials, more meshes than their rows hold, models with their
// partitions, and loses them again, keeps the one session it opened, is told of no reopen, and has
// nothing refused (`worldRuntime.fixture.ts` fails a test that was).
import test from 'node:test'
import assert from 'node:assert/strict'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { Material } from '../../../../sdk-core/src/world/material/material.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { listenWorldNotices } from '../diagnostic/worldNotices.ts'
import { LoadedModel } from './loadedModel.ts'
import type { ReopenCause } from './worldReopen.ts'
import { Scene } from './scene.ts'
import { runtimeOf, sessionStandIn, type Open } from './worldRuntime.fixture.ts'

/** Every cause of a reopen: adding one to the type breaks this table, and the proof with it. */
const CAUSES: Record<ReopenCause, true> = { 'device-lost': true, option: true }

/** A model of `count` meshes, `cells` partitions it places meshes by: the shape a world reads. */
function model(count: number, cells: object[] = []) {
  const source = new Group(),
    drawn = Array.from(
      { length: count },
      () => new Mesh(new Geometry(), new Material('meshStandard')),
    )
  source.add(...drawn)
  return new LoadedModel({
    base: 'file:///cache/',
    manifestUrl: 'file:///cache/manifest.json',
    metadataUrl: 'file:///cache/clusters.json',
    textureSource: 'host',
    metadata: { primitives: drawn.map((_, i) => ({ mesh: i, primitive: 0, pages: [] })) } as never,
    scene: {
      source,
      associations: new Map(drawn.map((mesh, i) => [mesh, { meshes: i }])),
      partitions: cells,
    } as never,
  })
}

test('the causes of a reopen are a lost device and an option, and no content change', () => {
  assert.deepEqual(Object.keys(CAUSES).sort(), ['device-lost', 'option'])
})

test('meshes, materials, rows, models and partitions join and leave one session, never a second', async () => {
  const heard: Record<string, unknown>[] = []
  const stop = listenWorldNotices(({ phase, context }) => {
    if (phase === 'session-reopen' || phase === 'content-refused') heard.push({ phase, ...context })
  })
  const { session } = sessionStandIn()
  const handed: string[] = []
  Object.assign(session, {
    growsInPlace: () => true,
    addPlacements: async () => (handed.push('source'), undefined),
    preparePartitions: async () => void handed.push('cells'),
    followPartitions: () => void handed.push('follow'),
    leavePartitions: () => void handed.push('leave'),
  })
  let opened = 0
  const open = (async () => (opened++, session)) as unknown as Open
  const scene = new Scene(() => Promise.reject(new Error('no loader')))
  const runtime = runtimeOf(scene, Promise.resolve(), (error) => assert.fail(String(error)), open)
  // What the scene changed is resolved, applied before the frame, and handed to the session.
  const change = async (apply: () => void) => {
    apply()
    await runtime.settled()
    runtime.beforeFrame()
    await runtime.settled()
  }
  const paint = material.meshStandard({ color: 0x336699 })
  const first = object.mesh(geometry.box(), paint)
  await change(() => scene.add(first))
  assert.equal(opened, 1)
  // A geometry and a material the session does not hold: each a batch handed to it.
  await change(() => scene.add(object.mesh(geometry.sphere(), paint)))
  await change(() =>
    scene.add(object.mesh(geometry.box(), material.meshStandard({ color: 0x993366 }))),
  )
  // More meshes of a batch than its rows hold: the rows grow in place.
  await change(() =>
    scene.add(...Array.from({ length: 40 }, () => object.mesh(geometry.box(), paint))),
  )
  await change(() => scene.remove(first))
  // A model with cells, then a second one, each leaving and coming back.
  const crowd = model(2, [{}]),
    plain = model(1)
  await change(() => scene.add(crowd))
  await change(() => scene.add(plain))
  await change(() => scene.remove(crowd))
  await change(() => scene.add(crowd))
  await change(() => scene.remove(plain, crowd))
  stop()
  assert.equal(opened, 1, 'the session opened once')
  assert.deepEqual(heard, [], 'no reopen, nothing refused')
  assert.deepEqual(
    handed.filter((step) => step !== 'source'),
    ['cells', 'follow', 'leave', 'follow', 'leave'],
  )
  runtime.dispose()
})

test('what the scene gains while the session opens joins it once opened, the session not opened again', async () => {
  const { session } = sessionStandIn()
  const handed: string[] = []
  Object.assign(session, {
    growsInPlace: () => true,
    addPlacements: async () => (handed.push('source'), undefined),
  })
  const scene = new Scene(() => Promise.reject(new Error('no loader')))
  let opened = 0
  // The scene is read for the session when it is asked to open: a model and a mesh of another
  // geometry enter it while it does, and a frame runs before the session is there.
  const open = (async () => {
    opened++
    scene.add(model(1), object.mesh(geometry.sphere()))
    await new Promise(setImmediate)
    runtime.beforeFrame()
    return session
  }) as unknown as Open
  const runtime = runtimeOf(scene, Promise.resolve(), (error) => assert.fail(String(error)), open)
  scene.add(object.mesh(geometry.box()))
  await runtime.settled()
  assert.equal(opened, 1)
  runtime.beforeFrame()
  await runtime.settled()
  assert.deepEqual(handed, ['source', 'source'], 'the model’s source and the mesh’s batch joined')
  assert.equal(opened, 1, 'no second session')
  runtime.dispose()
})
