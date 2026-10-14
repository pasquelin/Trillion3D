import assert from 'node:assert/strict'
import test from 'node:test'
import { behind } from './behind.ts'

test('work runs after the work in flight, a failure before stopping none, its own held', async () => {
  const owner = { pending: Promise.resolve() as Promise<unknown> },
    order: string[] = []
  const failed = behind(owner, async () => {
    order.push('first')
    throw new Error('refused')
  })
  const second = behind(owner, () => {
    order.push('second')
    return 2
  })
  await assert.rejects(failed, /refused/)
  assert.equal(await second, 2)
  assert.deepEqual(order, ['first', 'second'])
  assert.equal(owner.pending, second, 'the owner holds the last work, for whoever awaits it')
})
