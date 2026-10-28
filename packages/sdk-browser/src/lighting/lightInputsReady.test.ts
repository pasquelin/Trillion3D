// The inputs the light is made of are ready when the shadows have landed and the textures are whole.
import test from 'node:test'
import assert from 'node:assert/strict'
import { lightInputsReady } from './lightInputsReady.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'

const world = (pending = 0, converging = false) =>
  ({
    lights: {
      store: { count: 0, unlit: false, shadowedSuns: 0, shadowedLocals: 0 },
      vsm: undefined,
    },
    vis: { textures: { counters: { pending, pendingCoarse: pending } } },
    run: { textureConverging: converging },
    context: {},
    gpu: {},
  }) as unknown as WebgpuPagesRuntime

test('tiles pending at a finer level than the cards read hold nothing back: a moving camera over a streamed world has some all the time', () => {
  const rt = world() as unknown as { vis: { textures: { counters: { pending: number } } } }
  rt.vis.textures.counters.pending = 40
  assert.equal(lightInputsReady(rt as unknown as WebgpuPagesRuntime), true)
})

test('no pending texture and no shadow on its way: ready', () => {
  assert.equal(lightInputsReady(world()), true)
})

test('a pending texture, or a texture converging, is an input not ready', () => {
  assert.equal(lightInputsReady(world(3)), false)
  assert.equal(lightInputsReady(world(0, true)), false)
})

test('a session with no texture streamer waits for no texture', () => {
  const rt = world() as unknown as { vis: { textures?: unknown } }
  rt.vis.textures = undefined
  assert.equal(lightInputsReady(rt as unknown as WebgpuPagesRuntime), true)
})

test('a scene with a shadowed light whose shadow maps are not made yet has its shadows to come: not ready', () => {
  const rt = world() as unknown as { lights: { store: { shadowedSuns: number }; vsm: unknown } }
  rt.lights.store.shadowedSuns = 1
  assert.equal(lightInputsReady(rt as unknown as WebgpuPagesRuntime), false)
  rt.lights.store.shadowedSuns = 0
  assert.equal(
    lightInputsReady(rt as unknown as WebgpuPagesRuntime),
    true,
    'no shadowed light: nothing to wait for',
  )
})

test('shadows that will never exist are not waited for: cut (shadowQuality 0), or the pool refused', () => {
  const rt = world() as unknown as {
    lights: { store: { shadowedSuns: number }; vsmRefusal?: unknown }
    context: Record<string, unknown>
  }
  rt.lights.store.shadowedSuns = 1
  rt.context.shadowQuality = 0
  assert.equal(lightInputsReady(rt as unknown as WebgpuPagesRuntime), true, 'the shadows are cut')
  delete rt.context.shadowQuality
  rt.lights.vsmRefusal = {}
  assert.equal(lightInputsReady(rt as unknown as WebgpuPagesRuntime), true, 'the pool was refused')
})
