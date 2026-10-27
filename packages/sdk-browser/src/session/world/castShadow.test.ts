// Every mesh casts a shadow unless it says `castShadow = false`, as a light casts none unless
// it says `true`. A write reaches the world (`SceneLink.shadow`), and the mesh's row carries it to the
// engine (`PlacementRows.casting`), where its root leaves every light cut (`update.test.ts`). A saved
// scene keeps it; one of version 1, saved before a mesh's flag was read, is refused.
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
import {
  holdPrimitiveGroup,
  nodeCasting,
  SHADOW_MAPLESS_ROOT,
  SHADOWLESS_ROOT,
} from '../../visibility/shader/castingMark.ts'
import { castFlagsOf } from '../../lighting/shadows/casters/castFlags.ts'
import { MOBILITY_CAST_BITS, MOBILITY_SHADOWLESS } from '../../lighting/shadows/mobilityBits.ts'
import { flagsOf } from '../../lighting/distanceField/objectCasting.ts'
import { OBJECT_FLAGS } from '../../lighting/distanceField/layout.ts'
import type { Seat } from './batches.ts'
import { Scene } from './scene.ts'

test('a mesh and a light cast by default, a group does not, and a clone keeps the flag', () => {
  const mesh = object.mesh(geometry.box(1, 1, 1))
  assert.deepEqual(
    [mesh.castShadow, light.directional().castShadow, object.group().castShadow],
    [true, true, false],
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

test("a model node's flags reach the rows of the mesh it stands for, and its graph", () => {
  const models = createWorldModels(createWorldRanks()),
    { loaded, drawn } = loadedModel([{ meshes: 0 }])
  const draws = models.drawsOf(loaded)
  const node = modelNode(drawn[0])
  assert.equal(node.castShadow, true, "a node copies the graph's flag")
  node.castShadow = false
  writeModelNode(node)
  assert.equal(drawn[0].castShadow, false, 'written back into the graph')
  models.pose(loaded, true)
  assert.equal(draws.rowed[0].rows.casting[0], SHADOWLESS_ROOT)
  assert.equal(modelNode(drawn[0]).castShadow, false, 'a node built later copies it')
})

test('a saved scene keeps each flag, and one of version 1, whose flags were never read, is refused', async () => {
  const scene = new Scene(async () => new Object3D() as never)
  const [ink, box] = [0, 1].map(() => object.mesh(geometry.box(1, 1, 1)))
  ink.castShadow = false
  scene.add(ink, box, light.directional({ castShadow: false }))
  const casts = () => scene.children.map((node) => node.castShadow)
  const saved = scene.toJSON()
  await scene.fromJSON(saved)
  assert.deepEqual(casts(), [false, true, false], 'version 2 keeps every flag')
  await assert.rejects(scene.fromJSON({ ...saved, formatVersion: 1 }), {
    code: 'UNSUPPORTED_SCENE_FORMAT',
  })
  assert.deepEqual(casts(), [false, true, false], 'the scene is left as it was')
})

// A primitive's own switch (`castsShadowMaps`): one bit of the root's mark beside `castShadow`'s, which the
// rows carry and the mobility word of the shadow maps reads; the distance field reads the mark's
// `castShadow` alone and keeps the primitive.
test("a mesh's castsShadowMaps is true by default, is cloned, and reaches its world once per change", () => {
  const mesh = object.mesh(geometry.box(1, 1, 1))
  assert.equal(mesh.castsShadowMaps, true)
  const posed: unknown[] = []
  mesh._link = { shadow: (node) => void posed.push(node) } as Partial<SceneLink> as SceneLink
  mesh.castsShadowMaps = false
  mesh.castsShadowMaps = false
  assert.deepEqual(posed, [mesh], 'a write that changes nothing tells nothing')
  assert.equal(mesh.clone().castsShadowMaps, false)
  assert.equal(mesh.castShadow, true, 'the component switch is apart')
})

/** A mesh of two primitives: a group of one host mesh each, as the prepared scene builds one (`holdPrimitiveGroup`). */
function twoPrimitives() {
  const model = object.group(),
    parts = [0, 1].map(() => object.mesh(geometry.box(1, 1, 1)))
  holdPrimitiveGroup(model)
  model.add(...parts)
  return { model, parts }
}

test("a primitive's castsShadowMaps is a mark bit apart from castShadow's, carried by its row", () => {
  assert.ok(MOBILITY_CAST_BITS & MOBILITY_SHADOWLESS, 'a change of the bit stales the pages')
  const [mesh] = twoPrimitives().parts
  assert.equal(nodeCasting(mesh), 0)
  mesh.castsShadowMaps = false
  assert.equal(nodeCasting(mesh), SHADOW_MAPLESS_ROOT)
  mesh.castShadow = false
  assert.equal(nodeCasting(mesh), SHADOW_MAPLESS_ROOT | SHADOWLESS_ROOT, 'the two are apart')
  mesh.castShadow = true
  const rows = createPlacementRows(2),
    poses = createWorldPoses(),
    seat = { batch: { rows }, row: 1 } as unknown as Seat
  poses.writeSeat(mesh, seat, true)
  assert.deepEqual([...rows.casting], [0, SHADOW_MAPLESS_ROOT])
  assert.deepEqual([...growPlacementRows(rows, 3).casting], [0, SHADOW_MAPLESS_ROOT, 0, 0], 'kept')
  mesh.castsShadowMaps = true
  poses.writeSeat(mesh, seat, true)
  assert.deepEqual([...rows.casting], [0, 0])
})

test('a mesh of one primitive that leaves the shadow maps casts none at all, the distance fields included', () => {
  const mesh = object.mesh(geometry.box(1, 1, 1))
  mesh.castsShadowMaps = false
  assert.equal(nodeCasting(mesh), SHADOWLESS_ROOT)
  const lone = object.group()
  lone.add(mesh)
  assert.equal(
    nodeCasting(mesh),
    SHADOWLESS_ROOT,
    'a group that is no mesh’s primitives is not one mesh',
  )
})

test('a root whose primitive leaves the shadow maps is no raster caster, and keeps its distance field', () => {
  const root = { mark: SHADOW_MAPLESS_ROOT }
  assert.equal(castFlagsOf(root) & MOBILITY_SHADOWLESS, MOBILITY_SHADOWLESS, 'the raster skips it')
  assert.equal(castFlagsOf({ mark: 0 }) & MOBILITY_SHADOWLESS, 0)
  assert.equal(
    flagsOf(true, false, root.mark) & OBJECT_FLAGS.castShadow,
    OBJECT_FLAGS.castShadow,
    'the distance field still casts it',
  )
  assert.equal(
    flagsOf(true, false, SHADOWLESS_ROOT) & OBJECT_FLAGS.castShadow,
    0,
    'castShadow does not',
  )
})

test('a mesh whose every primitive leaves the shadow maps casts none into them, a sibling that does is kept', () => {
  const {
    model,
    parts: [glass, frame],
  } = twoPrimitives()
  glass.castsShadowMaps = false
  const marks = () => model.children.map((part) => nodeCasting(part))
  const words = () => marks().map((mark) => castFlagsOf({ mark }) & MOBILITY_SHADOWLESS)
  assert.deepEqual(marks(), [SHADOW_MAPLESS_ROOT, 0], 'a primitive apart from the others')
  assert.deepEqual(words(), [MOBILITY_SHADOWLESS, 0])
  frame.castsShadowMaps = false
  // The whole mesh casts none: no primitive is left in the distance field either.
  assert.deepEqual(marks(), [SHADOWLESS_ROOT, SHADOWLESS_ROOT])
  assert.deepEqual(words(), [MOBILITY_SHADOWLESS, MOBILITY_SHADOWLESS], 'every primitive: none')
  assert.equal(flagsOf(true, false, nodeCasting(glass)) & OBJECT_FLAGS.castShadow, 0)
  frame.castsShadowMaps = true
  assert.deepEqual(
    words(),
    [MOBILITY_SHADOWLESS, 0],
    'a sibling that casts again lets the others be what they said',
  )
})

test("a model node's castsShadowMaps reaches its graph node and the rows of the mesh it stands for", () => {
  const models = createWorldModels(createWorldRanks()),
    { loaded, drawn } = loadedModel([{ meshes: 0 }])
  const draws = models.drawsOf(loaded)
  const node = modelNode(drawn[0])
  assert.equal(node.castsShadowMaps, true, "a node copies the graph's flag")
  node.castsShadowMaps = false
  writeModelNode(node)
  assert.equal(drawn[0].castsShadowMaps, false, 'written back into the graph')
  models.pose(loaded, true)
  assert.equal(
    draws.rowed[0].rows.casting[0],
    SHADOWLESS_ROOT,
    'a mesh of one primitive casts none into the maps: none at all',
  )
  assert.equal(modelNode(drawn[0]).castsShadowMaps, false, 'a node built later copies it')
})

test('a saved scene keeps a primitive that leaves the shadow maps, written only when it does', async () => {
  const scene = new Scene(async () => new Object3D() as never)
  const [kept, left] = [0, 1].map(() => object.mesh(geometry.box(1, 1, 1)))
  left.castsShadowMaps = false
  scene.add(kept, left)
  const saved = scene.toJSON()
  assert.deepEqual(
    saved.children.map((node) => ('castsShadowMaps' in node ? node.castsShadowMaps : 'absent')),
    ['absent', false],
  )
  left.castsShadowMaps = true
  await scene.fromJSON(saved)
  assert.deepEqual(
    scene.children.map((node) => node.castsShadowMaps),
    [true, false],
  )
})
