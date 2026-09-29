// The WGSL run of the cut rule's tests is the kernel's own text (#486): `dagMask`'s call sites, the
// cone word `dagWanted` keeps for a camera's, the residency reads they make on the bit sets the host
// uploads, and the rule. An edit to any of them that breaks the rule fails here, in the unit gate,
// without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from './cutRule.fixture.ts';
import { wgslBackend, wgslLightBackend } from './cutRuleBackends.fixture.ts';
import { ruleChecks } from './cutRuleChecks.fixture.ts';
import { CUT_RULE_WGSL } from './rule.ts';
import { DAG_SELECTION_SHADER } from '../../gpu/dag/shader/shader.ts';

const THRESHOLD = 0.1;
const dag = ruleDag(256);
const { randomFrames } = ruleChecks(dag);
const FAULT = /not covered exactly once|drawn by/;
const PATHS = { camera: wgslBackend, light: wgslLightBackend };

/** The kernel with every `from` edited to `to`: the edit must land. */
function edited(from: string, to: string) {
  const source = DAG_SELECTION_SHADER.replaceAll(from, to);
  assert.notEqual(source, DAG_SELECTION_SHADER, `${from} is not in the kernel`);
  return source;
}

for (const [path, backend] of Object.entries(PATHS)) {
  test(`${path}: the kernel as written passes`, () => {
    randomFrames(backend(dag, THRESHOLD));
  });

  test(`${path}: a rule that forgets the missing finer group opens holes`, () => {
    assert.ok(DAG_SELECTION_SHADER.includes(CUT_RULE_WGSL), 'the kernel carries the rule');
    const forgets = edited('(ownWithin||!childResident)', 'ownWithin');
    assert.throws(() => randomFrames(backend(dag, THRESHOLD, forgets)), FAULT);
  });

  test(`${path}: a call site reading its own group for the finer one is caught`, () => {
    const own = edited('all||childResident(i)', 'all||isResident(i)');
    assert.throws(() => randomFrames(backend(dag, THRESHOLD, own)), FAULT);
  });

  test(`${path}: a residency read one word off the uploaded bits is caught`, () => {
    const shifted = edited(
      'coldAt(views[0u].clusterCount+(i>>5u))',
      'coldAt(views[0u].clusterCount+(i>>5u)+1u)',
    );
    assert.throws(() => randomFrames(backend(dag, THRESHOLD, shifted)), FAULT);
  });

  test(`${path}: a call site that ignores the cut holding residency is caught`, () => {
    const unheld = edited(
      'let all=views[0u].residentCut==0u;',
      'let all=views[0u].residentCut!=0u;',
    );
    assert.throws(() => randomFrames(backend(dag, THRESHOLD, unheld)), FAULT);
  });
}

test('camera: a call site reading the wrong comparison of the cone word is caught', () => {
  const swapped = edited('(word&OWN_WITHIN)!=0u', '(word&PARENT_ABOVE)!=0u');
  assert.throws(() => randomFrames(wgslBackend(dag, THRESHOLD, swapped)), FAULT);
});
