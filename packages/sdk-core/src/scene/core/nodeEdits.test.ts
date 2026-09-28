// nodeEdits.ts: every rename and every change of parent moves the count, whatever called it — what
// a name index built by a walk is dropped on (#915) — and a pose write does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Group } from '../../world/object/object3d.ts';
import { objectEdits } from './nodeEdits.ts';

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
  const edits = [
    () => (node.name = 'crate'),
    () => root.add(node),
    () => node.reparent(other),
    () => root.attach(node),
    () => root.remove(node),
    () => (root.add(node), root.clear()),
    () => node.clone(),
    () => node.destroy(),
  ];
  for (const edit of edits) assert.ok(counted(edit), String(edit));
});

test('objectEdits: the same name again, a pose or a visibility write is not counted', () => {
  const node = new Group();
  node.name = 'crate';
  for (const edit of [() => (node.name = 'crate'), () => node.position.set(1, 2, 3)])
    assert.ok(!counted(edit), String(edit));
  assert.ok(!counted(() => (node.visible = false)));
});
