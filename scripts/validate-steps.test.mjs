import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NATIVE_STEPS, VALIDATE_GROUPS, VALIDATE_STEPS, stepsToRun } from './validate-steps.mjs';

test('validate runs every gate by default, native ones included', () => {
  assert.deepEqual(stepsToRun({}), VALIDATE_STEPS);
  assert.deepEqual(stepsToRun({ WEB_GEOMETRY_SKIP_NATIVE: '' }), VALIDATE_STEPS);
  assert.deepEqual(NATIVE_STEPS, ['lint:native', 'build:native', 'test:native']);
});

test('WEB_GEOMETRY_SKIP_NATIVE=1 drops exactly the Rust steps and keeps their order', () => {
  const steps = stepsToRun({ WEB_GEOMETRY_SKIP_NATIVE: '1' });
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

test('a group runs its own gates, and every gate belongs to exactly one group', () => {
  for (const [group, gates] of Object.entries(VALIDATE_GROUPS))
    assert.deepEqual(stepsToRun({}, group), gates);
  assert.equal(new Set(VALIDATE_STEPS).size, VALIDATE_STEPS.length);
});

test('an unknown group stops the run instead of silently checking nothing', () => {
  assert.throws(() => stepsToRun({}, 'typescipt'), /Unknown validate group 'typescipt'/);
});

test('the native group alone is emptied when the binaries are restored', () => {
  assert.deepEqual(stepsToRun({ WEB_GEOMETRY_SKIP_NATIVE: '1' }, 'native'), []);
  assert.deepEqual(
    stepsToRun({ WEB_GEOMETRY_SKIP_NATIVE: '1' }, 'quick'),
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
