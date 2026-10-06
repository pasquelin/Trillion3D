import test from 'node:test'
import assert from 'node:assert/strict'
import { askedFrame } from './worldAskedFrame.ts'

const turn = () => new Promise((wake) => setImmediate(wake))

/** A world stand-in: what it lacks (`lack`, until `arrive`), whether its session is open, and
 *  the steps of the frames it drew, in order. A frame's image is the count of steps so far. */
function world() {
  const state = {
    lack: undefined as Promise<void> | undefined,
    arrive: () => {},
    open: true,
    closed: false,
    steps: [] as string[],
    failures: [] as unknown[],
  }
  const frame = askedFrame({
    waits: () => state.lack,
    draw: (ahead) => {
      ahead?.()
      if (state.open) return state.steps.length
      state.lack = new Promise((wake) => (state.arrive = wake)) // the session reopens
      return null
    },
    closed: () => state.closed,
    failed: (error) => state.failures.push(error),
  })
  const lacking = () => void (state.lack = new Promise((wake) => (state.arrive = wake)))
  const arrived = async () => ((state.lack = undefined), state.arrive(), await turn())
  const step = (name: string) => () => void state.steps.push(name)
  return { state, frame, lacking, arrived, step }
}

test('a frame asked of a world that can draw is drawn at once, its step first', () => {
  const { state, frame, step } = world()
  assert.equal(frame(step('a')), 1)
  assert.deepEqual(state.steps, ['a'])
})

test('frames asked while the world lacks something are one frame, drawn once it arrives', async () => {
  const { state, frame, lacking, arrived, step } = world()
  lacking()
  assert.equal(frame(step('a')), null, 'nothing drawn while it lacks')
  assert.equal(frame(step('b')), null)
  assert.deepEqual(state.steps, [], 'nothing steps ahead of the frame that waits')
  await arrived()
  assert.deepEqual(state.steps, ['b'], 'drawn once, with the step the last frame asked')
  await turn()
  assert.deepEqual(state.steps, ['b'], 'and not again')
})

test('a frame drawn meanwhile answers the one that waited', async () => {
  const { state, frame, lacking, step } = world()
  lacking()
  frame(step('waited'))
  const { arrive } = state
  state.lack = undefined // what it lacked no longer draws: the next frame draws at once
  frame(step('drawn'))
  arrive()
  await turn()
  assert.deepEqual(state.steps, ['drawn'], 'the frame that waited is not drawn on top')
})

test('a frame whose changes closed the session is drawn once the next one opens', async () => {
  const { state, frame, arrived, step } = world()
  state.open = false
  assert.equal(frame(step('a')), null, 'that frame has no image')
  state.open = true
  await arrived()
  assert.deepEqual(state.steps, ['a', 'a'], 'drawn by the session opened, stepped again')
  assert.equal(frame(), 2, 'then a frame draws at once')
})

test('a world closed meanwhile draws nothing; a frame that throws once drawn is said', async () => {
  const { state, frame, lacking, arrived, step } = world()
  lacking()
  frame(step('a'))
  state.closed = true
  await arrived()
  assert.deepEqual(state.steps, [], 'a closed world draws no frame that waited')
  state.closed = false
  lacking()
  frame(() => {
    throw new Error('a hook')
  })
  await arrived()
  assert.equal(String(state.failures[0]), 'Error: a hook', 'past the page call, said')
})
