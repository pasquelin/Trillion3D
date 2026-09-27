// The WGSL run of the cut rule's tests is the kernel's own text (#486): `dagMask`'s call sites, the
// cone word `dagWanted` keeps for a camera's, the residency reads they make on the bit sets the host
// uploads, and the rule. An edit to any of them that breaks the rule fails here, in the unit gate,
// without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from './cutRule.fixture.ts';
import { wgslBackend, wgslLightBackend } from './cutRuleBackends.fixture.ts';
import { coneWord } from './cutRuleWord.fixture.ts';
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
      'cold[views[0u].clusterCount+(i>>5u)]',
      'cold[views[0u].clusterCount+(i>>5u)+1u]',
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

const EDGES = [NaN, -Infinity, -0, 0, 0.1, 0.1000001, 1, 3.4e38, Infinity];

/** Whether `word` keeps, for every operand, the comparisons of the rule, stops a cone-rejected
 *  page at `dagMask`'s guard, and leaves a light cut's word clear (a light never cone-rejects). */
function keepsTheRule(word: ReturnType<typeof coneWord>) {
  const f32 = Math.fround;
  for (const parent of EDGES)
    for (const own of EDGES)
      for (const t of EDGES) {
        const bits = (f32(parent) > f32(t) ? 2 : 0) | (f32(own) <= f32(t) ? 4 : 0);
        const seen = word(false, parent, own, t),
          rejected = word(true, parent, own, t),
          light = word(true, parent, own, t, true);
        if (seen.word !== bits || !seen.open || rejected.open || light.word !== 0 || !light.open)
          return false;
      }
  return true;
}

test('camera: the cone word holds the rule comparisons, and a cone-rejected page never passes', () => {
  assert.equal(keepsTheRule(coneWord()), true);
  for (const [from, to] of [
    ['select(0u,CONE_REJECTED,rejected)', 'select(0u,OWN_WITHIN,rejected)'],
    ['if((word&CONE_REJECTED)==0u){', 'if((word&OWN_WITHIN)==0u){'],
    ['pixels.own<=t', 'pixels.own<t'],
    ['),0u,light)', '),0u,t<t)'],
  ])
    assert.equal(keepsTheRule(coneWord(edited(from, to))), false, `${from} → ${to}`);
});
