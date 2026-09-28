import assert from 'node:assert/strict';
import test from 'node:test';
import { roadmapEntries } from '../../app/examples/list.ts';
import { parkedExampleIds } from '../../../scripts/docs/examples/pages.ts';
import english from '../i18n/en.json' with { type: 'json' };
import { WAITING_ISSUES } from './waiting.inline.ts';
import { waitingLine } from './waiting.ts';
import { useWords } from './words.ts';

test('a parked example names the engine issue it waits for, and no other example does', () => {
  useWords(english, 'en');
  const parked = roadmapEntries.filter(({ status }) => status === 'waiting-engine');
  assert.ok(parked.length > 0);
  for (const { id, issue } of parked) {
    assert.ok(Number.isInteger(issue), `${id} names no issue`);
    assert.deepEqual(waitingLine(id), {
      text: `Waiting for the engine (#${issue})`,
      href: `https://github.com/pasquelin/Trillion3D/issues/${issue}`,
    });
  }
  for (const { id } of roadmapEntries.filter(({ status }) => status !== 'waiting-engine'))
    assert.equal(waitingLine(id), undefined, id);
  // The pages the browser proof opens without asking them to draw are the same list.
  assert.deepEqual(new Set(Object.keys(WAITING_ISSUES)), parkedExampleIds);
});
