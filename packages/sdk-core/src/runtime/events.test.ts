import assert from 'node:assert/strict'
import test from 'node:test'
import { userNotice, type RuntimeEvent } from './events.ts'

test('only an unrecovered blocking fatal event offers the scene retry action', () => {
  for (const type of ['fatal', 'degraded'])
    for (const audience of ['blocking', 'diagnostic'])
      for (const recovered of [false, true]) {
        const event = {
          eventVersion: 1,
          type,
          audience,
          recovered,
          code: 'DEVICE_LOST',
          detail: 'backend detail',
        } as RuntimeEvent
        const notice = userNotice(event)
        if (type === 'fatal' && audience === 'blocking' && recovered === false)
          assert.deepEqual(notice, { messageKey: 'scene-unavailable', action: 'retry' })
        else assert.equal(notice, null)
      }
})

test('notices do not depend on a backend name and are fresh for each failure', () => {
  const event: RuntimeEvent = {
    eventVersion: 1,
    type: 'fatal',
    audience: 'blocking',
    recovered: false,
    code: 'NETWORK',
  }
  const first = userNotice(event),
    second = userNotice({ ...event, code: 'WEBGPU_LOST' })
  assert.deepEqual(first, second)
  assert.notEqual(first, second)
})
