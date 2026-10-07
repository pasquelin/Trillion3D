// nodeEdits.ts: every rename and every change of parent moves the edit count, whatever called it —
// what a name index built by a walk is dropped on —, every field a watch compares moves the
// write count, and a pose write moves neither.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Group } from '../../world/object/object3d.ts'
import { Light } from '../../world/light/light.ts'
import { nodeWrites, objectEdits } from './nodeEdits.ts'

/** True when `edit` moved the count. */
function counted(edit: () => void) {
  const before = objectEdits()
  edit()
  return objectEdits() !== before
}

test('objectEdits: a rename, an add, a removal, a reparenting, an attach and a free are counted', () => {
  const root = new Group(),
    other = new Group(),
    node = new Group()
  const edits = [
    () => (node.name = 'crate'),
    () => root.add(node),
    () => node.reparent(other),
    () => root.attach(node),
    () => root.remove(node),
    () => (root.add(node), root.clear()),
    () => node.clone(),
    () => node.destroy(),
  ]
  for (const edit of edits) assert.ok(counted(edit), String(edit))
})

test('objectEdits: the same name again, a pose or a visibility write is not counted', () => {
  const node = new Group()
  node.name = 'crate'
  for (const edit of [() => (node.name = 'crate'), () => node.position.set(1, 2, 3)])
    assert.ok(!counted(edit), String(edit))
  assert.ok(!counted(() => (node.visible = false)))
})

test('nodeWrites: every field no pose hook hears moves it; a pose write does not', () => {
  const root = new Group(),
    node = new Group(),
    lamp = new Light('spot')
  root.add(node, lamp)
  const writes = [
    () => (node.visible = false),
    () => (node.castShadow = true),
    () => void node.matrix,
    () => node.setLocalMatrix(new Float64Array(16)),
    () => (node.matrixAutoUpdate = false),
    () => new Group().add(node),
    () => root.attach(node),
    () => (lamp.intensity = 3),
    () => lamp.color.setRGB(1, 0, 0),
    () => lamp.groundColor.setRGB(0, 0, 1),
    // Numbers written straight into an array or a colour, announced.
    () => (node.matrixWorldNeedsUpdate = true),
    () => (lamp.needsUpdate = true),
  ]
  for (const write of writes) {
    const before = nodeWrites()
    write()
    assert.notEqual(nodeWrites(), before, String(write))
  }
  const before = nodeWrites()
  node.position.set(4, 5, 6)
  node.quaternion.set(0, 1, 0, 0)
  node.visible = false // already hidden
  assert.equal(nodeWrites(), before, 'hooked poses are heard otherwise; a same value is no write')
})
