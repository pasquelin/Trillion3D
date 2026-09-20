import test from 'node:test';
import assert from 'node:assert/strict';
import { exactPagesBackend } from '../../packages/sdk/browser.ts';
test('Public browser export constructs the exact-cluster backend', () => {
  assert.equal(typeof exactPagesBackend, 'function');
});
