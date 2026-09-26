import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistory } from '../site/app/editor/history.ts';
import { poseOf, removeCommand, reparentCommand, samePose } from '../site/app/editor/commands.ts';
import { object } from '../packages/sdk-core/src/world/object/index.ts';

test('the editor history undoes and redoes in order, and forgets past its capacity', () => {
  const log: string[] = [];
  const history = createHistory(2);
  const step = (name: string) => ({
    undo: () => log.push(`undo ${name}`),
    redo: () => log.push(`redo ${name}`),
  });
  for (const name of ['a', 'b', 'c']) history.push(step(name));
  assert.equal(history.undo(), true);
  assert.equal(history.undo(), true);
  assert.equal(history.undo(), false, 'the oldest command fell past the capacity');
  assert.equal(history.redo(), true);
  history.push(step('d'));
  assert.equal(history.canRedo, false, 'a new command drops the undone ones');
  assert.deepEqual(log, ['undo c', 'undo b', 'redo b']);
});

test('a deletion undone puts the object back at its rank and gives the selection back', () => {
  const parent = object.group();
  const [a, b, c] = [object.group(), object.group(), object.group()];
  parent.add(a, b, c);
  const selected: unknown[] = [];
  const command = removeCommand(b, (node) => selected.push(node));
  command.redo();
  assert.deepEqual(parent.children, [a, c]);
  command.undo();
  assert.deepEqual(parent.children, [a, b, c], 'the sibling order is kept');
  assert.deepEqual(selected, [b], 'the selection comes back with the object');
});

test('a reparent keeps where the object stands, and undone gives back its parent and pose', () => {
  const [from, to, node] = [object.group(), object.group(), object.group()];
  from.position.set(1, 2, 3);
  from.scale.set(2, 3, 4);
  to.rotation.set(0, Math.PI / 2, 0);
  to.position.set(-1, 0, 0);
  from.add(node);
  node.position.set(1, 1, 1);
  const [world, before] = [node.getWorldPosition(), poseOf(node)];
  const stays = () => node.getWorldPosition().distanceTo(world) < 1e-12;
  const command = reparentCommand(node, to);
  command.redo();
  assert.ok(node.parent === to && !samePose(poseOf(node), before), 'a new local pose');
  assert.ok(stays(), 'the same place in the world');
  command.undo();
  assert.ok(node.parent === from && samePose(poseOf(node), before), 'its parent and pose back');
  command.redo();
  assert.ok(stays());
});
