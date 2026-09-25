// The cut rule's readiness counts its host tables, which the CPU total holds beside the decoded
// pages (`../../residency/memoryBudget.ts`): three bytes a placed page, four a culling node, one a
// group.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from '../../page/cut/cutRule.fixture.ts';
import { stripUniforms } from '../../page/cut/cutRuleBackends.fixture.ts';
import { createDagReadiness } from './readiness.ts';

test('the readiness counts three bytes a page, four a node and one a group', () => {
  const dag = ruleDag(64);
  const { packed } = stripUniforms(dag, 0.1);
  const readiness = createDagReadiness(packed);
  const expected = 3 * packed.pageCount + 4 * packed.nodeCount + dag.structure.groupCount;
  assert.equal(readiness.hostBytes, expected);
});
