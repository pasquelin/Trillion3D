// The one lifecycle of a worker that may fail (`workerLatch.ts`): served once its probe says yes,
// latched broken when it dies, made again after a release — and a probe that answers after its
// worker was released judges nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkerLatch } from './workerLatch.ts'

const worker = () => ({ alive: true, retired: false, retire() {} })

test('a worker serves once its probe says yes, and stays broken once it dies', async () => {
  const latch = createWorkerLatch(worker, async () => true)
  assert.equal(latch.open(), undefined, 'nothing waits on the probe')
  await Promise.resolve()
  const served = latch.open()!
  assert.ok(served)
  served.alive = false
  assert.equal(latch.open(), undefined)
  assert.ok(latch.broken)
  latch.release()
  assert.ok(!latch.broken, 'a release opens it again')
})

test("a probe that answers after its worker's release latches nothing", async () => {
  const verdicts: ((ok: boolean) => void)[] = []
  const latch = createWorkerLatch(worker, () => new Promise<boolean>((done) => verdicts.push(done)))
  latch.open()
  latch.release()
  latch.open()
  verdicts[0](false)
  await Promise.resolve()
  assert.ok(!latch.broken, 'the released worker is no judge of the new one')
  verdicts[1](true)
  await Promise.resolve()
  assert.ok(latch.open())
})

test('without a probe a worker serves at once; none made, none served', () => {
  assert.ok(createWorkerLatch(worker).open())
  assert.equal(createWorkerLatch(() => undefined).open(), undefined)
})
