// #834: WebGL2's render-scale controller reads the whole-frame timer (`frameTimer.ts`), mounted
// once a page leaves the scale to the budget: a frame over budget, drawn at the controller's scale
// while the view moves, lowers it; a held image measures no drawing and steps nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { RenderBackend } from '../../backend/types.ts'
import type { ExplorerSession } from '../session/session.ts'
import { autonomousRenderScale } from '../../backend/autonomous/renderScale.ts'
import { createExplorerDraw } from './draw.ts'

/** A context whose every frame query answers at once: 50 ms, far over any display's budget. */
const timedGl = () =>
  ({
    QUERY_RESULT_AVAILABLE: 1,
    getExtension: () => ({ TIME_ELAPSED_EXT: 2, GPU_DISJOINT_EXT: 3 }),
    createQuery: () => ({}),
    beginQuery() {},
    endQuery() {},
    flush() {},
    deleteQuery() {},
    getParameter: () => false,
    getQueryParameter: (_query: unknown, name: number) => (name === 1 ? true : 50e6),
  }) as unknown as WebGL2RenderingContext

/** Draws `frames` frames of an engine whose page asked `{ min: 0.5 }`; returns its scale after. */
function steered(frames: number, held: boolean) {
  const { renderScaleControl: control, ...api } = autonomousRenderScale({
    renderScale: { min: 0.5 },
  })
  const backend = {
    id: 'engine',
    frameHeld: held,
    overBudget: false,
    render() {},
    renderScaleControl: control,
    ...api,
  } as unknown as RenderBackend
  const session = {
    scope: 'test',
    emit() {},
    diagnose() {},
    options: {},
  } as unknown as ExplorerSession
  const draw = createExplorerDraw(session, {
    camera: {},
    geometryUrls: new Set(),
    streamer: { retainRanks() {} },
    streaming: { queuedFetch: new Set() },
    directGpu: false,
    webglSurface: { context: timedGl() },
    baseline: backend,
    state: { measuring: false },
    // The composer's part (`./renderScale.ts`): a moving image at the controller's scale.
    compose: () => {
      control.drawn = control.wanted()
      control.steered = !held
    },
  } as unknown as Parameters<typeof createExplorerDraw>[1])
  for (let i = 0; i < frames; i++) draw(backend, null)
  return control.wanted()
}

test('a moving frame over budget lowers the WebGL2 render scale, a held one never', () => {
  // Past the controller's period (`PERIOD`) after the refresh clock's first frames.
  assert.ok(steered(12, false) < 1, 'lowered')
  assert.equal(steered(12, true), 1, 'held')
})
