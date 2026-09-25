// The Node runner of a pure WGSL predicate: it runs the kernel's rule text as written, agrees with
// the TypeScript rule on every operand order, and refuses what it does not understand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CUT_RULE_WGSL, drawsCluster } from './rule.ts';
import { wgslPredicate } from './wgslPredicate.fixture.ts';

test('the WGSL cut rule agrees with the TypeScript rule on every case', () => {
  const wgsl = wgslPredicate(CUT_RULE_WGSL, 'drawsCluster');
  const pixels = [0, 0.1, 0.1000001, 0.5, 1, 3.4e38];
  for (const resident of [false, true])
    for (const childResident of [false, true])
      for (const parent of pixels)
        for (const own of pixels)
          for (const threshold of [0.1, 0.5]) {
            const args = [resident, parent, own, childResident, threshold] as const;
            assert.equal(wgsl(...args), drawsCluster(...args), JSON.stringify(args));
          }
});

test('anything beyond parameters, logic and comparisons is refused', () => {
  const fn = (body: string) => `fn p(a:bool,b:f32)->bool{return ${body};}`;
  assert.equal(wgslPredicate(fn('!a||(b>=b&&a)'), 'p')(false, 1), true);
  assert.throws(() => wgslPredicate(fn('b>0.5'), 'p'), /WGSL_PREDICATE_TOKEN/);
  assert.throws(() => wgslPredicate(fn('c'), 'p'), /WGSL_PREDICATE_NAME/);
  assert.throws(() => wgslPredicate(fn('abs(b)>b'), 'p'), /WGSL_PREDICATE/);
  assert.throws(() => wgslPredicate(fn('a'), 'q'), /WGSL_PREDICATE_MISSING/);
  assert.throws(() => wgslPredicate('fn p(a:u32)->bool{return a;}', 'p'), /WGSL_PREDICATE_TYPE/);
});
