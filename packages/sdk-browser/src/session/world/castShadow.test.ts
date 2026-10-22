// Every mesh casts a shadow unless it says `castShadow = false`, as a light casts none unless
// it says `true`. A write reaches the world (`SceneLink.shadow`), and the mesh's row carries it to the
// engine (`PlacementRows.casting`), where its root leaves every light cut (`update.test.ts`), as
// `castFarShadow` keeps it in a sun's far shadows. A saved scene keeps both (the far one only when
// set, so a version 2 file saved before it still loads); one of version 1, saved before a mesh's
// flag was read, is refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { light } from '../../../../sdk-core/src/world/light/light.ts'
import type { SceneLink } from '../../../../sdk-core/src/world/object/sceneLink.ts'
import { createPlacementRows, growPlacementRows } from '../../placement/rows/rows.ts'
import { createWorldPoses } from './poses/poses.ts'
import { modelNode, writeModelNode } from './models/modelNodes.ts'
import { createWorldModels } from './models/models.ts'
import { loadedModel } from './models/models.fixture.ts'
import { createWorldRanks } from './ranks.ts'
import { FAR_SHADOW_ROOT, SHADOWLESS_ROOT } from '../../visibility/shader/castingMark.ts'
import type { Seat } from './batches.ts'
import { Scene } from './scene.ts'

test('a mesh casts by default, a light and a group do not, and a clone keeps the flag', () => {
  const mesh = object.mesh(geometry.box(1, 1, 1))
  assert.deepEqual(
    [mesh.castShadow, light.directional().castShadow, object.group().castShadow],
    [true, false, false],
  )
  mesh.castShadow = false
  assert.equal(mesh.clone().castShadow, false)
})

test("a mesh's castShadow reaches its world once per change, and its row carries it", () => {
  const mesh = object.mesh(geometry.box(1, 1, 1))
  const posed: unknown[] = []
  mesh._link = { shadow: (node) => void posed.push(node) } as Partial<SceneLink> as SceneLink
  mesh.castShadow = false
  mesh.castShadow = false
  assert.deepEqual(posed, [mesh], 'a write that changes nothing tells nothing')
  const rows = createPlacementRows(2),
    poses = createWorldPoses(),
    seat = { batch: { rows }, row: 1 } as unknown as Seat
  poses.writeSeat(mesh, seat, true)
  assert.deepEqual([...rows.casting], [0, SHADOWLESS_ROOT])
  assert.deepEqual([...growPlacementRows(rows, 3).casting], [0, SHADOWLESS_ROOT, 0, 0], 'kept')
  mesh.castShadow = true
  poses.writeSeat(mesh, seat, true)
  assert.deepEqual([...rows.casting], [0, 0])
})

test("a mesh's castFarShadow is false by default, and its row carries it beside castShadow", () => {
  const mesh = object.mesh(geometry.box(1, 1, 1))
  assert.equal(mesh.castFarShadow, false)
  const rows = createPlacementRows(2),
    poses = createWorldPoses(),
    seat = { batch: { rows }, row: 1 } as unknown as Seat
  poses.writeSeat(mesh, seat, true)
  assert.deepEqual([...rows.casting], [0, 0])
  mesh.castFarShadow = true
  poses.writeSeat(mesh, seat, true)
  assert.deepEqual(
    [...rows.casting],
    [0, FAR_SHADOW_ROOT],
    'it still casts: the two flags are apart',
  )
  mesh.castShadow = false
  poses.writeSeat(mesh, seat, true)
  assert.deepEqual([...rows.casting], [0, FAR_SHADOW_ROOT | SHADOWLESS_ROOT])
  assert.deepEqual([...growPlacementRows(rows, 3).casting], [0, 36, 0, 0], 'kept as rows grow')
})

test("a model node's flags reach the rows of the mesh it stands for, and its graph", () => {
  const models = createWorldModels(createWorldRanks()),
    { loaded, drawn } = loadedModel([{ meshes: 0 }])
  const draws = models.drawsOf(loaded)
  const node = modelNode(drawn[0])
  assert.equal(node.castFarShadow, false, "a node copies the graph's flag")
  node.castFarShadow = true
  writeModelNode(node)
  assert.equal(drawn[0].castFarShadow, true, 'written back into the graph')
  models.pose(loaded, true)
  assert.equal(draws.rowed[0].rows.casting[0], FAR_SHADOW_ROOT)
  node.castShadow = false
  writeModelNode(node)
  models.pose(loaded, true)
  assert.equal(draws.rowed[0].rows.casting[0], FAR_SHADOW_ROOT | SHADOWLESS_ROOT)
  assert.equal(modelNode(drawn[0]).castFarShadow, true, 'a node built later copies it')
})

test('a saved scene keeps each flag, and one of version 1, whose flags were never read, is refused', async () => {
  const scene = new Scene(async () => new Object3D() as never)
  const [ink, box] = [0, 1].map(() => object.mesh(geometry.box(1, 1, 1)))
  ink.castShadow = false
  box.castFarShadow = true
  scene.add(ink, box, light.directional({ castShadow: false }))
  const casts = () => scene.children.map((node) => [node.castShadow, node.castFarShadow])
  const saved = scene.toJSON()
  assert.equal('castFarShadow' in saved.children[0], false, 'written only when set')
  await scene.fromJSON(saved)
  assert.deepEqual(
    casts(),
    [
      [false, false],
      [true, true],
      [false, false],
    ],
    'version 2 keeps every flag',
  )
  await assert.rejects(scene.fromJSON({ ...saved, formatVersion: 1 }), {
    code: 'UNSUPPORTED_SCENE_FORMAT',
  })
  assert.equal(casts()[1][1], true, 'the scene is left as it was')
})

test('a version 2 file saved before the far flag loads, every mesh casting none far', async () => {
  const scene = new Scene(async () => new Object3D() as never)
  const box = object.mesh(geometry.box(1, 1, 1))
  box.castFarShadow = true
  scene.add(box)
  const saved = scene.toJSON()
  assert.equal(saved.formatVersion, 2)
  // The file as it was saved before the field: no node names it.
  const old = {
    ...saved,
    children: saved.children.map((node) => {
      const before: Record<string, unknown> = { ...node }
      delete before.castFarShadow
      return before
    }),
  }
  await scene.fromJSON(old as never)
  assert.equal(scene.children[0].castFarShadow, false)
  assert.equal(scene.children[0].castShadow, true)
})
