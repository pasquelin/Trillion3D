// The compiles in flight on a device and whether its frames wait for each: a compile the frames wait for holds them, a prepared one does not.
import test from 'node:test'
import assert from 'node:assert/strict'
import { heldCompiles, pipelinesCompiling, pipelinesSettled, track } from './compileLedger.ts'

const deferred = () => {
  let settle!: () => void
  const promise = new Promise<void>((resolve) => (settle = resolve))
  return { promise, settle }
}
const turns = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve()
}

test('a compile the frames wait for holds them and is named; one prepared beside them does not, but prepare waits for it', async () => {
  const device = {} as GPUDevice
  const prepared = deferred(),
    asked = deferred()
  track(device, prepared.promise, false)
  assert.equal(pipelinesCompiling(device), false, 'prepared: no frame waits')
  assert.equal(pipelinesSettled(device, true), undefined, 'the frames wait for nothing')
  assert.ok(pipelinesSettled(device), 'prepare waits for every compile')
  track(device, asked.promise, true, 'pass')
  assert.equal(pipelinesCompiling(device), true)
  assert.deepEqual(heldCompiles(device), ['pass'], 'named, the prepared one not among them')
  track(device, prepared.promise, true, 'now needed')
  // In the order the ledger first saw them: the prepared one came first.
  assert.deepEqual(
    heldCompiles(device),
    ['now needed', 'pass'],
    'a prepared compile a frame came to need holds it',
  )
  asked.settle()
  prepared.settle()
  await turns()
  assert.equal(pipelinesCompiling(device), false)
  assert.deepEqual(heldCompiles(device), [])
  assert.equal(pipelinesSettled(device), undefined)
})

test('a compile asked again as a wait it already is adds nothing; a weaker ask does not take the wait back', async () => {
  const device = {} as GPUDevice
  const compile = deferred()
  track(device, compile.promise, true, 'once')
  track(device, compile.promise, true, 'twice')
  track(device, compile.promise, false)
  assert.deepEqual(heldCompiles(device), ['once'])
  compile.settle()
  await turns()
  assert.equal(pipelinesCompiling(device), false)
})
