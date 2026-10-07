import test from 'node:test'
import assert from 'node:assert/strict'
import { runtimeMaterials } from './runtimeMaterials.ts'
import { bitmapFixture } from './bitmap.fixture.ts'
import { refusal } from './materialApi.fixture.ts'
import type { Engine } from '../../engine/types.ts'
import type { GraphSurface } from '../../host/graph/surface.ts'
import { RUNTIME_MAP_BYTES_CEILING } from './runtimeMapCeiling.ts'

function engine(admit: (surface: GraphSurface) => Promise<void> = async () => {}) {
  const released: GraphSurface[] = []
  const backend = {
    signal: new AbortController().signal,
    admitMaterial: admit,
    releaseMaterial: (surface: GraphSurface) => released.push(surface),
  } as unknown as Engine
  return { backend, released }
}

function pendingEngine() {
  let resume!: () => void
  const ready = new Promise<void>((resolve) => {
    resume = resolve
  })
  return { ...engine(() => ready), resume }
}

test('map admission reserves bytes before allocation, publishes only after readiness and drops them', async (t) => {
  const bitmap = bitmapFixture(t),
    { backend, released, resume } = pendingEngine()
  const api = runtimeMaterials(() => {}, backend)
  const image = bitmap(4096, 4096)
  const pending = api.createMaterial({ map: image })
  assert.equal(api.mapBytes(), RUNTIME_MAP_BYTES_CEILING)
  assert.equal(api.created.size, 0, 'not assignable before admission')
  assert.throws(() => api.createMaterial({ map: bitmap() }), refusal('TEXTURE_BUDGET'))
  assert.equal(api.mapBytes(), RUNTIME_MAP_BYTES_CEILING)
  resume()
  const made = await pending
  assert.deepEqual(made.tiling, [1, 1])
  api.drop(made.id)
  assert.equal(api.mapBytes(), 0)
  assert.equal(released.length, 1)
  assert.equal(image.closed, false, 'the caller owns the bitmap')
  const next = await api.createMaterial({ map: bitmap() })
  assert.notEqual(next.id, made.id, 'IDs cannot alias a dropped handle')
  api.dispose()
  assert.equal(api.mapBytes(), 0)
})

test("a failed admission rolls back whole: its bytes, its surface and the engine's admission", async (t) => {
  const bitmap = bitmapFixture(t),
    failing = engine(async () => {
      throw new Error('upload failed')
    })
  const api = runtimeMaterials(() => {}, failing.backend)
  await assert.rejects(api.createMaterial({ map: bitmap() }), /upload failed/)
  assert.equal(api.created.size, 0)
  assert.equal(api.mapBytes(), 0)
  assert.equal(failing.released.length, 1)
})

test('disposal during admission never publishes a late surface and releases its borrowed map', async (t) => {
  const bitmap = bitmapFixture(t),
    { backend, released, resume } = pendingEngine()
  const api = runtimeMaterials(() => {}, backend)
  const image = bitmap(),
    pending = api.createMaterial({ map: image })
  api.dispose()
  resume()
  await assert.rejects(pending, /session closed/)
  assert.equal(api.created.size, 0)
  assert.equal(api.mapBytes(), 0)
  assert.equal(released.length, 1)
  assert.equal(image.closed, false)
})

test('two materials borrowing one bitmap have separate texture ownership and release independently', async (t) => {
  const bitmap = bitmapFixture(t),
    { backend, released } = engine()
  const api = runtimeMaterials(() => {}, backend),
    image = bitmap()
  const first = await api.createMaterial({ map: image }),
    second = await api.createMaterial({ map: image })
  assert.equal(api.mapBytes(), 32)
  api.drop(first.id)
  assert.equal(api.mapBytes(), 16)
  assert.equal(api.created.has(second.id), true)
  api.drop(second.id)
  assert.notEqual(released[0].map, released[1].map)
  assert.equal(image.closed, false)
})
