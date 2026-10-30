// The lit programs of a pass (`contractVariants.ts`): `pick` asks for the program and lends it once compiled.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createLitVariants } from './contractVariants.ts'

test('pick asks for the program and lends it once compiled, asking no other', async () => {
  let builds = 0
  const variants = createLitVariants<{ id: number }>(async () => ({ id: ++builds }), {
    twins: false,
  })
  assert.equal(builds, 0, 'nothing asked')
  assert.equal(variants.pick(false, false, 0), undefined, 'compiling')
  assert.equal(builds, 1)
  await variants.settle()
  assert.equal(variants.pick(false, false, 0)?.id, 1)
  assert.equal(builds, 1, 'lending asks no other')
})
