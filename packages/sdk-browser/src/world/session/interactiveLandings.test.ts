// The loop's settle limit follows the engine's own landings (#836): a view whose pages come back
// from memory, no fetch counted, is still drawn to its last page before the loop pauses.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startInteractiveExplorer } from './interactive.ts'
import { frameQueue } from '../render/frameQueue.fixture.ts'

test('pages the engine makes resident without a fetch keep the loop drawing past the limit', async () => {
  const frames = frameQueue(),
    listeners = { addEventListener() {}, removeEventListener() {} }
  let landings = 0,
    drawn = 0
  const view = {
    requestAnimationFrame: frames.request,
    cancelAnimationFrame: frames.cancel,
    ...listeners,
    matchMedia: () => listeners,
    devicePixelRatio: 1,
  }
  const runtime = {
    canvas: { clientWidth: 4, clientHeight: 4, ownerDocument: { defaultView: view } },
    options: { width: 4, height: 4, pixelRatio: 1 },
    ownedControls: [],
    state: { disposed: false },
    pendingFrame: async () => true,
    familiesPending: () => undefined,
    engine: { measureFrame: () => false, landings: () => landings },
  }
  // Two hundred pages landed from memory, one per frame: the fetch count never moves.
  const explorer = { render: () => (++drawn <= 200 && landings++, { pageLoads: 7 }), resize() {} }
  const config = { ownControls: false, pixelRatio: 1 }
  startInteractiveExplorer(explorer as never, runtime as never, config as never, {
    emit() {},
    diagnose() {},
  })
  while (frames.run()) await new Promise(setImmediate)
  assert.equal(landings, 200, 'every page landed was drawn')
  assert.equal(drawn, 200 + 120, 'then the limit, counted from the last landing')
})
