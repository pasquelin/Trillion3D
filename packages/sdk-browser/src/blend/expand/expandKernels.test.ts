import test from 'node:test'
import assert from 'node:assert/strict'
import { compileBlendExpand } from './expandKernels.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

test('the expansion kernels are built with every creation under a scope, after the awaits too', async () => {
  const { device } = fakeDevice({ strictScopes: true })
  const kernels = await compileBlendExpand(device)
  assert.ok(kernels.expandStages && kernels.orderStages && kernels.verdictStages)
})
