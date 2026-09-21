import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_STEPS, VALIDATE_STEPS, stepsToRun } from './validate-steps.mjs';

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
