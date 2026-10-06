// The interactive session's layout rules, which need a CSS box and no GPU: a hidden canvas keeps
// its drawing buffer, a canvas whose box follows its own drawing buffer is refused by name, and a
// disposed session hears no resize. Read here on a window and a canvas of the test's own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startInteractiveExplorer } from './interactive.ts'
import { frameQueue } from '../render/frameQueue.fixture.ts'

/** A window whose `resize` listeners the test fires, its frames a queue the test runs. */
function testWindow(devicePixelRatio: number) {
  const events = new EventTarget(),
    frames = frameQueue()
  return {
    frames,
    view: {
      devicePixelRatio,
      requestAnimationFrame: frames.request,
      cancelAnimationFrame: frames.cancel,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
      resize: () => events.dispatchEvent(new Event('resize')),
    },
  }
}

/** Starts the loop on `canvas`, its session sized `width` × `height` at `pixelRatio`; the world's
 *  resizes are recorded and written into the canvas's drawing buffer, as the engine writes them. */
function startOn(
  canvas: { width: number; height: number; clientWidth: number; clientHeight: number },
  view: ReturnType<typeof testWindow>['view'],
  options: { width: number; height: number; pixelRatio: number },
) {
  const resized: number[][] = []
  const hostedControls: { dispose(): void }[] = []
  const explorer = {
    render: () => ({}),
    resize(width: number, height: number) {
      resized.push([width, height])
      canvas.width = width * options.pixelRatio
      canvas.height = height * options.pixelRatio
    },
  }
  const runtime = {
    canvas: Object.assign(canvas, { ownerDocument: { defaultView: view } }),
    options: { ...options },
    hostedControls,
    state: { disposed: false },
    pendingFrame: async () => false,
    landings: () => undefined,
    familiesPending: () => undefined,
    measureFrame: () => false,
  }
  const events = { emit() {}, diagnose() {} }
  const config = { ownControls: false, interactive: true }
  startInteractiveExplorer(explorer as never, runtime as never, config as never, events as never)
  return { resized, dispose: () => hostedControls.forEach((one) => one.dispose()) }
}

test('a hidden canvas keeps its drawing buffer until its box shows again', () => {
  const { view } = testWindow(2)
  const canvas = { width: 1120, height: 560, clientWidth: 560, clientHeight: 280 }
  const { resized } = startOn(canvas, view, { width: 560, height: 280, pixelRatio: 2 })
  canvas.clientWidth = canvas.clientHeight = 0
  view.resize()
  assert.deepEqual(resized, [], 'a box of no size resizes nothing')
  assert.deepEqual([canvas.width, canvas.height], [1120, 560])
  canvas.clientWidth = 200
  canvas.clientHeight = 280
  view.resize()
  assert.deepEqual(resized, [[200, 280]], 'the box shown again is drawn at its size')
})

test('a canvas whose CSS box follows its drawing buffer is refused by name', () => {
  const { view } = testWindow(2)
  // An unsized canvas: its CSS box is its drawing buffer's size, which the session doubles.
  const canvas = {
    width: 600,
    height: 300,
    get clientWidth() {
      return this.width
    },
    get clientHeight() {
      return this.height
    },
  }
  assert.throws(
    () => startOn(canvas, view, { width: 300, height: 150, pixelRatio: 2 }),
    /Set canvas CSS width and height independently of its drawing buffer/,
  )
})

test('a disposed session hears no resize and asks no frame', () => {
  const { view, frames } = testWindow(1)
  const canvas = { width: 400, height: 300, clientWidth: 400, clientHeight: 300 }
  const { resized, dispose } = startOn(canvas, view, { width: 400, height: 300, pixelRatio: 1 })
  while (frames.run());
  dispose()
  canvas.clientWidth = 200
  view.resize()
  assert.deepEqual(resized, [])
  assert.equal(frames.size, 0)
})
