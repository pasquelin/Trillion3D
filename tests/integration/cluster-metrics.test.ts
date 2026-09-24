import test from 'node:test';
import assert from 'node:assert/strict';
import { exactPagesBackend } from '../../bench/witnesses/measurement.ts';
test('The measurement entry constructs the exact-cluster backend', () => {
  assert.equal(typeof exactPagesBackend, 'function');
});
