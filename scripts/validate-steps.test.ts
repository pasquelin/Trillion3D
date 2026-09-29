import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NATIVE_STEPS, VALIDATE_GROUPS, VALIDATE_STEPS, stepsToRun } from './validate-steps.ts';

test('validate runs every gate by default, native ones included', () => {
  assert.deepEqual(stepsToRun({}), VALIDATE_STEPS);
  assert.deepEqual(stepsToRun({ TRILLION3D_SKIP_NATIVE: '' }), VALIDATE_STEPS);
  assert.deepEqual(NATIVE_STEPS, ['lint:native', 'build:native', 'test:native']);
});

test('TRILLION3D_SKIP_NATIVE=1 drops exactly the Rust steps and keeps their order', () => {
  const steps = stepsToRun({ TRILLION3D_SKIP_NATIVE: '1' });
  assert.deepEqual(
    steps,
    VALIDATE_STEPS.filter((step) => !step.endsWith(':native')),
  );
  assert.ok(
    steps.includes('format:check'),
    'cargo fmt --check stays: it reads sources, not artefacts',
  );
  assert.ok(steps.includes('test'), 'the JS tests stay: they run the restored binary');
});

test('a group runs its own gates, the API files written first, and a full run runs each gate once', () => {
  for (const [group, gates] of Object.entries(VALIDATE_GROUPS))
    assert.deepEqual(stepsToRun({}, group), gates);
  for (const gates of [VALIDATE_GROUPS.quick, VALIDATE_GROUPS.typescript])
    assert.equal(gates[0], 'generate:api', 'lint, knip, check:i18n and the site types read them');
  assert.equal(new Set(VALIDATE_STEPS).size, VALIDATE_STEPS.length);
  for (const gates of Object.values(VALIDATE_GROUPS))
    for (const gate of gates) assert.ok(VALIDATE_STEPS.includes(gate), gate);
});

test('the unit suite runs where the compiled compiler and dist both exist', () => {
  const unit: readonly string[] = VALIDATE_GROUPS.unit;
  assert.ok(
    unit.indexOf('build') < unit.indexOf('test'),
    'dist/ is read by the integration tests, so tsc comes first',
  );
  assert.ok(
    unit.indexOf('build:native') < unit.indexOf('test'),
    'a suite run without the binary would skip the compiler tests in silence',
  );
  for (const [group, gates] of Object.entries(VALIDATE_GROUPS))
    assert.equal(
      (gates as readonly string[]).includes('test'),
      group === 'unit',
      'nowhere else: the unit job is the one the CI shards',
    );
});

test('the scene caches, never tracked, are compiled between the compiler and the tests that read them', () => {
  const native: readonly string[] = VALIDATE_GROUPS.native;
  assert.ok(native.indexOf('build:native') < native.indexOf('compile:caches'));
  assert.ok(native.indexOf('compile:caches') < native.indexOf('test:native'), 'the colliders test');
});

test('an unknown group stops the run instead of silently checking nothing', () => {
  assert.throws(() => stepsToRun({}, 'typescipt'), /Unknown validate group 'typescipt'/);
});

test('restored binaries drop the Rust gates, and keep the suite that drives them', () => {
  assert.deepEqual(stepsToRun({ TRILLION3D_SKIP_NATIVE: '1' }, 'unit'), ['build', 'test']);
  assert.deepEqual(
    stepsToRun({ TRILLION3D_SKIP_NATIVE: '1' }, 'quick'),
    VALIDATE_GROUPS.quick,
    'the source gates never depend on the Rust binaries',
  );
});

const workflow = readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

test('the CI gives each group a job, and no gate is left unrun', () => {
  const run = [...workflow.matchAll(/pnpm run validate --group (\w+)/g)].map(([, group]) => group);
  assert.deepEqual(run.sort(), Object.keys(VALIDATE_GROUPS).sort());
});

test('the unit shards cover shards 1..n of the same file list', () => {
  const [, list] = /^ +shard: \[([\d, ]+)\]$/m.exec(workflow) ?? [];
  assert.ok(list, 'a shard matrix');
  const shards = list.split(',').map(Number);
  assert.deepEqual(
    shards,
    Array.from({ length: shards.length }, (_, i) => i + 1),
  );
  assert.ok(shards.length > 1, 'a matrix of one shard would not split the suite');
  assert.match(
    workflow,
    /TRILLION3D_TEST_SHARD: \$\{\{ matrix\.shard \}\}\/\$\{\{ strategy\.job-total \}\}$/m,
  );
});

test('the one required check needs every job of the workflow', () => {
  const jobs = [...workflow.slice(workflow.indexOf('\njobs:\n')).matchAll(/^ {2}([\w-]+):$/gm)]
    .map(([, job]) => job)
    .filter((job) => job !== 'validate');
  const [, needs] = /^ {2}validate:\n {4}needs: \[([^\]]+)\]$/m.exec(workflow) ?? [];
  assert.ok(needs, '`validate` lists its needs');
  assert.deepEqual(needs.split(', ').sort(), jobs.sort());
});

test('a push run never cancels the pull request run that proves the merge with develop', () => {
  const [, group] = /^ {2}group: (.+)$/m.exec(workflow) ?? [];
  assert.ok(group, 'a concurrency group');
  const of = (context: Record<string, string>) =>
    group.replace(/\$\{\{ github\.(\w+) \}\}/g, (_, name: string) => {
      assert.ok(name in context, `github.${name}`);
      return context[name];
    });
  const push = { workflow: 'Quality', event_name: 'push', ref: 'refs/heads/1054-ci-shards' };
  const pr = { workflow: 'Quality', event_name: 'pull_request', ref: 'refs/pull/7/merge' };
  assert.doesNotMatch(of(push), /\$\{\{/, 'every expression of the key is rendered');
  assert.notEqual(of(push), of(pr));
  assert.notEqual(of(push), of({ ...push, ref: 'refs/heads/1055-other' }), 'one group per branch');
});

test('no gate asks for an example thumbnail: the recette captures them after the merge', () => {
  // `VALIDATE_STEPS` holds every group, `TREE_GATES` (what `check:changed` runs) among them.
  assert.ok(!(VALIDATE_STEPS as readonly string[]).includes('check:thumbnails'));
});
