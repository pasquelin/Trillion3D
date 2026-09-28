import assert from 'node:assert/strict';
import test from 'node:test';
import { parkedEntries, roadmapEntries } from '../../app/examples/list.ts';
import english from '../i18n/en.json' with { type: 'json' };
import { waitingLine } from './waiting.ts';
import { useWords } from './words.ts';

test('a parked example names the engine issue it waits for, and no other example does', () => {
  useWords(english, 'en');
  assert.ok(parkedEntries.length > 0);
  for (const { id, issue } of parkedEntries) {
    assert.ok(Number.isInteger(issue), `${id} names no issue`);
    assert.deepEqual(waitingLine(id), {
      text: `Waiting for the engine (#${issue})`,
      href: `https://github.com/pasquelin/Trillion3D/issues/${issue}`,
    });
  }
  const parked = new Set(parkedEntries);
  for (const entry of roadmapEntries.filter((entry) => !parked.has(entry)))
    assert.equal(waitingLine(entry.id), undefined, entry.id);
});
