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
  const native: readonly string[] = VALIDATE_GROUPS.native;
  assert.ok(
    native.indexOf('build') < native.indexOf('test'),
    'dist/ is read by the integration tests, so tsc comes first',
  );
  assert.ok(
    native.indexOf('build:native') < native.indexOf('test'),
    'a suite run without the binary would skip the compiler tests in silence',
  );
  for (const gates of [VALIDATE_GROUPS.quick, VALIDATE_GROUPS.typescript])
    assert.ok(
      !(gates as readonly string[]).includes('test'),
      'nowhere else: the binary is only in the native job',
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
  assert.deepEqual(stepsToRun({ TRILLION3D_SKIP_NATIVE: '1' }, 'native'), [
    'compile:caches',
    'build',
    'test',
  ]);
  assert.deepEqual(
    stepsToRun({ TRILLION3D_SKIP_NATIVE: '1' }, 'quick'),
    VALIDATE_GROUPS.quick,
    'the source gates never depend on the Rust binaries',
  );
});

test('the CI gives each group a job, and no gate is left unrun', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/quality.yml', import.meta.url),
    'utf8',
  );
  const run = [...workflow.matchAll(/pnpm run validate --group (\w+)/g)].map(([, group]) => group);
  assert.deepEqual(run.sort(), Object.keys(VALIDATE_GROUPS).sort());
});
