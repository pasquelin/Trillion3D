// The screen probes' history begins with its inputs ready: the shadows landed, the textures whole, the cache's lighting begun — not established:
// a moving camera never settles it — so that two worlds of one scene, whose inputs came at other instants, end on the same history.
import test from 'node:test'
import assert from 'node:assert/strict'
import { followHistory, probeInputsReady } from './historyReady.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

const world = (over: { pending?: number; begun?: boolean; converging?: boolean } = {}) =>
  ({
    lights: {
      store: { count: 0, unlit: false, shadowedSuns: 0, shadowedLocals: 0 },
      vsm: undefined,
    },
    vis: {
      textures: { counters: { pending: over.pending ?? 0, pendingCoarse: over.pending ?? 0 } },
    },
    run: { textureConverging: over.converging ?? false },
    context: {},
    gpu: {},
    // A cache still busy or settling is no input: only its lighting's latch is (`begun`).
    surfaceCache: { busy: true, lighting: { begun: over.begun ?? true, settle: 40 } },
  }) as unknown as WebgpuPagesRuntime

test("the inputs are ready when no texture is pending and the cache's lighting has begun, though the cache is busy and its light settling", () => {
  assert.equal(probeInputsReady(world()), true)
})

test('a pending texture, or a cache whose lighting has not begun, is an input not ready', () => {
  assert.equal(probeInputsReady(world({ pending: 2 })), false)
  assert.equal(probeInputsReady(world({ converging: true })), false)
  assert.equal(probeInputsReady(world({ begun: false })), false)
})

test('a session with no surface cache or no texture streamer waits for neither', () => {
  const rt = world() as unknown as { surfaceCache?: unknown; vis: { textures?: unknown } }
  rt.surfaceCache = undefined
  rt.vis.textures = undefined
  assert.equal(probeInputsReady(rt as unknown as WebgpuPagesRuntime), true)
})

test('the history begins at the image its inputs are ready, and is not dropped after', () => {
  const view = { history: true, frame: 7, begun: false }
  followHistory(view, false)
  assert.deepEqual(view, { history: false, frame: 0, begun: false })
  followHistory(view, false)
  assert.deepEqual(
    view,
    { history: false, frame: 0, begun: false },
    'nothing carried before the inputs',
  )
  followHistory(view, true)
  followHistory(view, true)
  assert.deepEqual(view, { history: true, frame: 2, begun: true })
  followHistory(view, false)
  assert.deepEqual(
    view,
    { history: true, frame: 3, begun: true },
    'begun, a lost input drops nothing: the light changes, it is not unlit',
  )
})
