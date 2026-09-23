import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistory } from '../site/app/editor/history.ts';
import { removeCommand } from '../site/app/editor/commands.ts';
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
