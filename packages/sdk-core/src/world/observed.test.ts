import test from 'node:test'
import assert from 'node:assert/strict'
import { ObservedComponents, listen, unlisten } from './observed.ts'

test('each of x, y and z written is heard once', () => {
  const value = new ObservedComponents(new Float64Array(3))
  let heard = 0
  listen(value, () => heard++)
  value.x = 1
  value.y = 2
  value.z = 3
  assert.deepEqual([value.x, value.y, value.z, heard], [1, 2, 3, 3])
})

test('shared numbers move into the store given, and later writes land there', () => {
  const value = new ObservedComponents(new Float64Array([1, 2, 3]))
  const store = new Float64Array(3)
  value._share(store)
  assert.deepEqual(Array.from(store), [1, 2, 3])
  value.y = 7
  assert.equal(store[1], 7)
})

test('taking off a listener never chained leaves every chained one in place', () => {
  const value = new ObservedComponents(new Float64Array(3))
  const heard: string[] = []
  listen(value, () => heard.push('a'))
  assert.doesNotThrow(() => unlisten(value, () => {}), 'a lone listener, another taken off')
  listen(value, () => heard.push('b'))
  unlisten(value, () => {})
  value.x = 1
  assert.deepEqual(heard, ['a', 'b'])
})
