import test from 'node:test'
import assert from 'node:assert/strict'
import { createListeners } from './listeners.ts'

test('a listener hears each emit until it leaves, and none after a clear', () => {
  const listeners = createListeners<[string]>()
  const heard: string[] = []
  const leave = listeners.subscribe((word) => heard.push(`a${word}`))
  listeners.subscribe((word) => heard.push(`b${word}`))
  listeners.emit('1')
  leave()
  listeners.emit('2')
  listeners.clear()
  listeners.emit('3')
  assert.deepEqual(heard, ['a1', 'b1', 'b2'])
})

test('a listener that leaves while it is told does not skip the next one', () => {
  const listeners = createListeners()
  const heard: string[] = []
  const leave = listeners.subscribe(() => {
    heard.push('first')
    leave()
  })
  listeners.subscribe(() => heard.push('second'))
  listeners.emit()
  listeners.emit()
  assert.deepEqual(heard, ['first', 'second', 'second'])
})
