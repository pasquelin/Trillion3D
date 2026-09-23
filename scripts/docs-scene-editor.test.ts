import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistory } from '../site/app/editor/history.ts';

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
