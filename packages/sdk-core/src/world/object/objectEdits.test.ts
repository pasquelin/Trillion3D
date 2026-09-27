// objectEdits.ts: every rename and every change of parent moves the count, whatever called it —
// what a name index built by a walk is dropped on (#915) — and a pose write does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Group } from './object3d.ts';
import { objectEdits } from './objectEdits.ts';

/** True when `edit` moved the count. */
function counted(edit: () => void) {
  const before = objectEdits();
  edit();
  return objectEdits() !== before;
}

test('objectEdits: a rename, an add, a removal, a reparenting, an attach and a free are counted', () => {
  const root = new Group(),
    other = new Group(),
    node = new Group();
  assert.ok(counted(() => (node.name = 'crate')));
  assert.ok(counted(() => root.add(node)));
  assert.ok(counted(() => other.add(node)));
  assert.ok(counted(() => root.attach(node)));
  assert.ok(counted(() => node.reparent(other)));
  assert.ok(counted(() => other.remove(node)));
  root.add(node);
  assert.ok(counted(() => root.clear()));
  assert.ok(counted(() => node.clone()));
  assert.ok(counted(() => node.destroy()));
});

test('objectEdits: the same name again, a pose or a visibility write is not counted', () => {
  const node = new Group();
  node.name = 'crate';
  assert.ok(!counted(() => (node.name = 'crate')));
  assert.ok(!counted(() => node.position.set(1, 2, 3)));
  assert.ok(!counted(() => (node.visible = false)));
  assert.equal(node.name, 'crate');
});
