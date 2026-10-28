// The bench says why a world failed: the engine's code, its message and the cause under it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldFailure } from './play.ts'

test('the failure names the code, the message and the cause of the world’s error', () => {
  const cause = new Error('manifest unreadable')
  const text = worldFailure({
    error: { code: 'SESSION_OPEN_FAILED', message: 'could not open', details: { cause } },
  })
  assert.match(text, /BENCH_WORLD: SESSION_OPEN_FAILED could not open/)
  assert.match(text, /cause: .*manifest unreadable/s)
  assert.match(worldFailure({ error: null }), /reports no error/)
})
