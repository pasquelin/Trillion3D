import test from 'node:test'
import assert from 'node:assert/strict'
import { createCharacterPort } from './physicsCharacter.ts'
import type { ToPhysics } from './protocol.ts'

const message = (key: string) => ({ type: 'character', key }) as unknown as ToPhysics

test('the held messages go out one argument each, as the session send reads its second as a transfer list', () => {
  const calls: unknown[][] = []
  // The session's `send(message, transfer = [])`, which `Worker.postMessage` rejects a number for.
  const send = (...args: unknown[]) => void calls.push(args)
  const port = createCharacterPort(send as (m: ToPhysics) => void, () => 0)
  port.send(message('a'))
  port.send(message('b'))
  port.send(message('c'))
  assert.equal(calls.length, 0, 'held until the first commands have gone')
  port.flush()
  assert.deepEqual(
    calls.map((args) => args.length),
    [1, 1, 1],
    'no index or array rides along',
  )
  port.send(message('d'))
  assert.equal(calls.length, 4)
  assert.equal(calls[3].length, 1)
})
