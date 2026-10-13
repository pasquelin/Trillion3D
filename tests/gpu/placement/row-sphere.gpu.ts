// The sphere kernel on a device (`placement/gpuComposeWgsl.ts`, `composeSphere`) against the CPU's
// formula (`placement/rowSphere.ts`): the centre's words are the CPU's, the radius is the CPU's
// single-precision steps' to the bit — or, where the device fuses a multiply-add or rounds a root
// differently, within the few units in the last place the formula's growth covers.
import test from 'node:test'
import assert from 'node:assert/strict'
import { runOnDawn } from '../kit/onDawn.ts'
import { runSphere } from './rowSphereRun.ts'

test('the device’s sphere is the CPU’s: the centre to the bit, the radius within the growth', async () => {
  const result = await runOnDawn(runSphere, undefined)
  assert.deepEqual(result.errors, [], 'no GPU error')
  assert.equal(result.centreDiffers, 0, 'the centre, word for word')
  console.log(`radius: ${result.radiusDiffers} of 600 differ, by at most ${result.radiusUlps} ulp`)
  assert.ok((result.radiusUlps ?? 0) <= 4, `${result.radiusUlps} ulp`)
})
