import test from 'node:test';
import assert from 'node:assert/strict';
import { exactPagesBackend } from '@web-geometry/sdk/browser';
test('Public browser export constructs the exact-cluster backend', () => {
  assert.equal(typeof exactPagesBackend, 'function');
});
