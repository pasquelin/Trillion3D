import test from 'node:test'
import assert from 'node:assert/strict'
import { PAGE_INTEGRATION_PROTOCOL } from '../../packages/sdk-core/src/index.ts'
import { PAGE_TASK_PROTOCOL } from '../../packages/sdk-core/src/page/taskContracts.ts'
import { installedWorkerRequests, runInstalledWorkers } from './workers.ts'

test('the installed-package proof speaks the workers’ current protocols', () => {
  const { page, integration } = installedWorkerRequests()
  assert.equal(page.protocol, PAGE_TASK_PROTOCOL)
  assert.equal(page.op, 'cells')
  assert.equal(integration.protocol, PAGE_INTEGRATION_PROTOCOL)
})

test('the in-page runner writes no protocol of its own', () => {
  // `page.evaluate` ships the function's source alone: a literal there would drift unseen.
  assert.doesNotMatch(runInstalledWorkers.toString(), /protocol\s*:/)
})
