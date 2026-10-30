// The states a stage keeps by view (`./viewState.ts`) and the values it publishes (`./viewPublished.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { viewPublished } from './viewPublished.ts'
import { disposeViewStates, viewState } from './viewState.ts'

test('a view state is released with its view and with no other', () => {
  const disposed: object[] = []
  const states = viewState<{ id: number }>((state) => disposed.push(state))
  const a: { viewKey?: object } = {},
    b: { viewKey?: object } = {}
  const mine = { id: 1 },
    theirs = { id: 2 }
  states.set(a, mine)
  states.set(b, theirs)
  assert.equal(states.get(a), mine)
  disposeViewStates(a)
  assert.deepEqual(disposed, [mine])
  assert.equal(states.get(a), undefined)
  assert.equal(states.get(b), theirs)
  states.release(b)
  assert.deepEqual(disposed, [mine, theirs])
  disposeViewStates(b)
  assert.equal(disposed.length, 2)
})

test("a published value is the view's own and goes with undefined", () => {
  const published = viewPublished<{ id: number }>()
  const a: { viewKey?: object } = {},
    b: { viewKey?: object } = {}
  const value = { id: 1 }
  published.publish(a, value)
  assert.equal(published.of(a), value)
  assert.equal(published.of(b), undefined)
  published.publish(a, undefined)
  assert.equal(published.of(a), undefined)
})
