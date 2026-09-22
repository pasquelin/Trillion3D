import test from 'node:test';
import assert from 'node:assert/strict';
import { exactPagesBackend } from '../../packages/sdk-browser/measurement.ts';
test('The measurement entry constructs the exact-cluster backend', () => {
  assert.equal(typeof exactPagesBackend, 'function');
});
