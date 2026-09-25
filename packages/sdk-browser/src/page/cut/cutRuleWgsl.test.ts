// The WGSL run of the cut rule's tests is the kernel's own text (#486): `dagMask`'s call site, the
// residency reads it makes on the bit sets the host uploads, and the rule. An edit to any of them
// that breaks the rule fails here, in the unit gate, without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from './cutRule.fixture.ts';
import { wgslBackend } from './cutRuleBackends.fixture.ts';
import { ruleChecks } from './cutRuleChecks.fixture.ts';
import { CUT_RULE_WGSL } from './rule.ts';
import { DAG_SELECTION_SHADER } from '../../gpu/dag/shader/shader.ts';

const THRESHOLD = 0.1;
const dag = ruleDag(256);
const { randomFrames } = ruleChecks(dag);
const FAULT = /not covered exactly once|drawn by/;

/** The kernel with `from` edited to `to`: the edit must land. */
function edited(from: string, to: string) {
  const source = DAG_SELECTION_SHADER.replace(from, to);
  assert.notEqual(source, DAG_SELECTION_SHADER, `${from} is not in the kernel`);
  return source;
}

test('the kernel as written passes', () => {
  randomFrames(wgslBackend(dag, THRESHOLD));
});

test('a rule that forgets the missing finer group opens holes', () => {
  assert.ok(DAG_SELECTION_SHADER.includes(CUT_RULE_WGSL), 'the kernel carries the rule');
  const forgets = edited('(ownPixels<=threshold||!childResident)', 'ownPixels<=threshold');
  assert.throws(() => randomFrames(wgslBackend(dag, THRESHOLD, forgets)), FAULT);
});

test('a call site reading its own group for the finer one is caught', () => {
  const own = edited('all||childResident(i),', 'all||isResident(i),');
  assert.throws(() => randomFrames(wgslBackend(dag, THRESHOLD, own)), FAULT);
});

test('a residency read one word off the uploaded bits is caught', () => {
  const shifted = edited(
    'cold[views[0u].clusterCount+(i>>5u)]',
    'cold[views[0u].clusterCount+(i>>5u)+1u]',
  );
  assert.throws(() => randomFrames(wgslBackend(dag, THRESHOLD, shifted)), FAULT);
});

test('a call site that ignores the cut holding residency is caught', () => {
  const unheld = edited('let all=views[0u].residentCut==0u;', 'let all=views[0u].residentCut!=0u;');
  assert.throws(() => randomFrames(wgslBackend(dag, THRESHOLD, unheld)), FAULT);
});
