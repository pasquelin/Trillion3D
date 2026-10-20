// A frame of `createExplorerRender`: the engine's error is the caller's, the followed guides move
// once before it draws within the frame's budget, and the frame report files only in debug mode.
// The triangles a frame submitted are the engine's own count, `totalSubmittedTriangles`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createExplorerRender } from './render.ts'
import { createFrameBudget } from '../../geometry/integration/frameBudget.ts'
import { createDiagnosticChannel } from '../../diagnostic/channel.ts'
import type { Engine } from '../../session/engine/types.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import { setDebugMode } from '../../session/host/debugMode.ts'

/** A minimal set of inputs for `createExplorerRender`: mute draw, diagnostic off, audit
 *  off (debug mode off). Only the engine count varies. */
function harness(options: {
  counted?: number | null
  order?: string[]
  fails?: boolean
  drawFails?: boolean
  recorded?: unknown[]
}) {
  const note = (step: string) => void options.order?.push(step)
  const engine = {
    id: 'test-backend',
    cpuStep() {},
    frameCpuMs() {},
  } as unknown as Engine
  const metricsScratch = { drawCalls: 0, totalSubmittedTriangles: null } as unknown as FrameMetrics
  const session = {
    scope: 'full' as const,
    diagnosticChannel: createDiagnosticChannel(undefined, { enabled: false }),
    diagnose: () => {},
  }
  const render = createExplorerRender(session, {
    check: () => {},
    followCells: null,
    guides: { follow: () => options.order?.push('follow') },
    state: { diagnostic: 'beauty', frame: 0 } as never,
    engine,
    camera: {} as never,
    lookAtTarget: { x: 0, y: 0, z: 0 },
    setPose: () => {},
    streaming: {
      arrivals: { drain: () => (note('drain'), options.fails && assert.fail()) },
    } as never,
    frameBudget: {
      ...createFrameBudget(Infinity),
      open: () => (note('open'), 0),
      pause: () => note('pause'),
    },
    drawFrame: () => {
      if (options.drawFails) throw new Error('draw failed')
      options.order?.push('draw')
    },
    fillMetrics: () => {
      metricsScratch.totalSubmittedTriangles = options.counted ?? null
      return { resident: 0, evictions: 0 } as never
    },
    metricsScratch,
    profiler: { record: (metrics: unknown) => options.recorded?.push(metrics) } as never,
    pageIdByUrl: new Map(),
    streamer: { stats: () => ({ resident: 0, evictions: 0 }) } as never,
  })
  return { render, metricsScratch }
}

// The engine is the session's one path: an error it throws is the caller's, never swapped for
// another engine's image.
test('an engine error leaves the frame, nothing drawn in its place', () => {
  const { render, metricsScratch } = harness({ drawFails: true, counted: 7 })
  assert.throws(render, /draw failed/)
  assert.equal(metricsScratch.cpuFrameMs, undefined, 'no metric of a frame not drawn')
})

// The guides that follow a node are moved once per frame, before it draws. The frame's
// one budget runs around its integration only, and stops before the engine draws, on every path.
test('each frame moves the followed guides once, and integrates within its budget, before it draws', () => {
  const order: string[] = []
  const { render } = harness({ order })
  render()
  assert.deepEqual(order, ['follow', 'open', 'drain', 'pause', 'draw'])
  order.length = 0
  assert.throws(harness({ order, fails: true }).render)
  assert.deepEqual(order, ['follow', 'open', 'drain', 'pause'], 'a drain that throws still pauses')
})

// The frame report is a debug tool, as a development build's: a page that never asks for
// debug mode files no frame into it.
test('a frame is filed into the frame report only in debug mode', (t) => {
  t.after(() => setDebugMode(false))
  const recorded: unknown[] = []
  const { render } = harness({ recorded })
  render()
  assert.equal(recorded.length, 0, 'outside debug mode, no frame is filed')
  setDebugMode(true)
  render()
  assert.equal(recorded.length, 1, 'in debug mode, the frame is filed')
})
