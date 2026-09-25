// The cut rule's readiness over a packing counts its host tables, which the CPU total holds beside
// the decoded pages (`../../residency/memoryBudget.ts`): they follow the resident pages, never the
// catalogue (#483 rule 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from '../../page/cut/cutRule.fixture.ts';
import { stripUniforms } from '../../page/cut/cutRuleBackends.fixture.ts';
import { createDagReadiness } from './readiness.ts';

test('the readiness holds nothing until a page is resident, and nothing once all have left', () => {
  const dag = ruleDag(64);
  const { packed } = stripUniforms(dag, 0.1);
  const readiness = createDagReadiness(packed);
  const none = new Uint8Array(packed.pageCount);
  readiness.apply(none);
  assert.equal(readiness.hostBytes, 0);
  readiness.apply(new Uint8Array(packed.pageCount).fill(1));
  assert.ok(readiness.hostBytes > 0);
  readiness.apply(none);
  assert.equal(readiness.hostBytes, 0);
});
