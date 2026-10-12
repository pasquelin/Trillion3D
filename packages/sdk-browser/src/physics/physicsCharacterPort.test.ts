import test from 'node:test'
import assert from 'node:assert/strict'
import { createCharacterPort } from './physicsCharacter.ts'
import { createSessionState, createWorkerLink } from './session/sessionLink.ts'
import { createStepClock } from './stepClock.ts'
import type { ToPhysics } from './protocol.ts'
import type { CommandWriter } from '../../../sdk-core/src/physics/index.ts'
import type { startPhysicsWorker } from './sessionWorker.ts'

const message = (key: string) => ({ type: 'character', key }) as unknown as ToPhysics

test('the held messages reach the worker with no transfer list, the link sending one argument', () => {
  const posts: unknown[][] = []
  const worker = { postMessage: (...args: unknown[]) => void posts.push(args) }
  const link = createWorkerLink(
    createSessionState(),
    worker as unknown as ReturnType<typeof startPhysicsWorker>,
    { length: 0 } as CommandWriter,
    createStepClock(1 / 60),
    1 / 60,
  )
  const port = createCharacterPort(link.send, link.at)
  port.send(message('a'))
  port.send(message('b'))
  port.send(message('c'))
  assert.equal(posts.length, 0, 'held until the first commands have gone')
  port.flush()
  port.send(message('d'))
  assert.deepEqual(
    posts.map(([, transfer]) => transfer),
    [[], [], [], []],
    'no index rides along as a transfer list',
  )
})
