import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_DECODE_PROTOCOL, PAGE_INTEGRATION_PROTOCOL } from '../packages/sdk-core/src/index.ts';
import { installedWorkerRequests, runInstalledWorkers } from './installed-package-workers.ts';

test('the installed-package proof speaks the workers’ current protocols', () => {
  const { decode, integration } = installedWorkerRequests();
  assert.equal(decode.protocol, PAGE_DECODE_PROTOCOL);
  assert.equal(decode.op, 'decode');
  assert.equal(integration.protocol, PAGE_INTEGRATION_PROTOCOL);
});

test('the in-page runner writes no protocol of its own', () => {
  // `page.evaluate` ships the function's source alone: a literal there would drift unseen.
  assert.doesNotMatch(runInstalledWorkers.toString(), /protocol\s*:/);
});
