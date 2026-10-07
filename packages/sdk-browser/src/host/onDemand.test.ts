import test from 'node:test'
import assert from 'node:assert/strict'
import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import { RETRY_AFTER_CAP_MS } from '../cluster/retryCap.ts'
import { onDemand } from './onDemand.ts'

test('a module on demand is imported once, on the first read, and read once it has arrived', async () => {
  let imports = 0
  const code = onDemand(
    'particles',
    async () => (imports++, { name: 'particles' }),
    () => {},
  )
  await code.settled()
  assert.equal(imports, 0, 'nothing read, nothing imported')
  assert.equal(code.get(), undefined, 'asked, it is on its way')
  assert.equal(code.arrived, false)
  await code.settled()
  assert.deepEqual([code.get(), code.arrived, imports], [{ name: 'particles' }, true, 1])
  assert.deepEqual(await code.load(), { name: 'particles' })
  assert.equal(imports, 1)
})

test('an import that fails once is tried again, as the HTTP loader asks a file again', async () => {
  let imports = 0
  const told: EngineError[] = []
  const code = onDemand(
    'effects',
    async () => {
      if (++imports === 1) throw new TypeError('Failed to fetch dynamically imported module')
      return { name: 'effects' }
    },
    (error) => told.push(error),
  )
  assert.deepEqual(await code.load(), { name: 'effects' })
  assert.deepEqual([imports, code.arrived, told], [2, true, []])
})

test('an import that always fails is FAMILY_LOAD_FAILED naming its family, asked again later', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  let imports = 0
  const told: EngineError[] = []
  const code = onDemand(
    'guides',
    () => (imports++, Promise.reject(new Error('CHUNK_MISSING'))),
    (error) => told.push(error),
  )
  await assert.rejects(code.load(), /T3D-E090 FAMILY_LOAD_FAILED: the guides family.*CHUNK_MISSING/)
  assert.deepEqual([imports, told.length, code.arrived], [2, 1, false], 'two attempts, told once')
  assert.deepEqual(
    [told[0].code, told[0].details.family, told[0].details.attempts],
    ['FAMILY_LOAD_FAILED', 'guides', 2],
  )
  // Not refused for good: the next ask starts a new round once the HTTP loader's longest wait
  // has passed.
  assert.equal(code.get(), undefined)
  const round = code.settled()
  await Promise.resolve()
  assert.equal(imports, 2, 'not before the wait')
  t.mock.timers.tick(RETRY_AFTER_CAP_MS)
  await round
  assert.deepEqual([imports, told.length], [4, 2])
})
