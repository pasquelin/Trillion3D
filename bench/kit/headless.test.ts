// The site's page helpers, headless: the opening poses the camera at once and at every frame by its step, and ends when the pose says so.
import test from 'node:test'
import assert from 'node:assert/strict'
import { language, opening, readout, viewModes, words } from './headless.ts'

function world() {
  const hooks = new Set<(frame: { delta: number }) => void>()
  let invalidated = 0,
    updated = 0
  return {
    hooks,
    count: () => [invalidated, updated],
    onFrame: (hook: (frame: { delta: number }) => void) => (
      hooks.add(hook),
      () => void hooks.delete(hook)
    ),
    invalidate: () => void invalidated++,
    controls: { update: () => void updated++ },
  }
}

test('the opening poses at once and every frame by its step, and ends when the pose answers false', () => {
  const w = world(),
    posed: number[] = []
  const glide = opening(w, (time) => (posed.push(time), time < 0.1), 1 / 60)
  assert.deepEqual(posed, [0], 'posed at once')
  for (let i = 0; i < 10; i++) for (const hook of w.hooks) hook({ delta: 1 })
  assert.equal(glide.gliding, false, 'landed')
  assert.equal(posed.at(-1)! >= 0.1, true)
  assert.deepEqual(w.count()[0], posed.length, 'a frame asked each time')
  const before = posed.length
  for (const hook of w.hooks) hook({ delta: 1 })
  assert.equal(posed.length, before, 'no pose after it landed')
  glide.restart()
  assert.equal(glide.gliding, true)
  glide.dispose()
  assert.equal(w.hooks.size, 0)
})

test('without a step the glide follows the frame, a hidden tab bounded at 50 ms', () => {
  const w = world(),
    posed: number[] = []
  opening(w, (time) => void posed.push(time))
  for (const hook of w.hooks) hook({ delta: 9 })
  assert.equal(posed.at(-1), 0.05)
})

test('readouts write nothing, the words are their keys, the language is English', () => {
  assert.equal(readout('trianglesDrawn')('1'), undefined)
  assert.equal(viewModes({}), undefined)
  assert.equal(words()('notCounted'), 'notCounted')
  assert.equal(language(), 'en')
})
