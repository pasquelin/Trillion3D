// A session disposed with shadows drawn frees what its virtual shadow maps hold — the page
// tables, the physical pool, the passes' buffers and targets — silently. A device that refuses
// the maps under a live session still says why, and the frame is lit without them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SUN } from '../../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts'
import { along, camera } from '../testScenes.fixture.ts'
import { floorCasterBackend } from '../../shadow/floorCaster.fixture.ts'

/** What the virtual shadow maps made on `gpu`: their buffers and textures, by label. */
const vsmResources = (gpu: { buffers: unknown[]; textures: unknown[] }) =>
  ([...gpu.buffers, ...gpu.textures] as { label?: string; destroyed?: boolean }[]).filter(
    ({ label }) => label?.startsWith('vsm.'),
  )

/** A caster over a floor, lit by the sun, drawn then moved once: its shadow maps are made. */
async function drawnShadows(refuse = false) {
  const said: string[] = [],
    lit: Record<string, unknown>[] = []
  const { backend, gpu } = await floorCasterBackend(SUN, {
    diagnosticDetail: 'summary',
    onDiagnostic: ({ phase, context }) => {
      said.push(phase)
      if (phase === 'direct-lighting-frame') lit.push(context)
    },
  })
  if (refuse) {
    const device = gpu.device as unknown as { createBuffer: (d: GPUBufferDescriptor) => unknown }
    const make = device.createBuffer.bind(device)
    device.createBuffer = (descriptor) => {
      if (descriptor.label?.startsWith('vsm.')) throw new Error('out of memory')
      return make(descriptor)
    }
  }
  const view = camera()
  backend.render(view)
  await backend.flush()
  backend.setTransform!('caster', along(0.1))
  backend.render(view)
  await backend.flush()
  return { backend, gpu, said, lit }
}

test('a disposed session frees every virtual shadow map resource, and says nothing', async (t) => {
  const warned = t.mock.method(console, 'warn', () => {})
  const { backend, gpu, said } = await drawnShadows()
  const made = vsmResources(gpu)
  assert.ok(made.length, 'the shadow maps were made')
  said.length = 0
  await backend.dispose()
  for (let tick = 0; tick < 8; tick++) await new Promise((next) => setTimeout(next, 0))
  assert.deepEqual(
    made.filter(({ destroyed }) => !destroyed).map(({ label }) => label),
    [],
    'every map resource freed',
  )
  assert.deepEqual(said, [])
  assert.equal(warned.mock.callCount(), 0)
})

test('a device that refuses the virtual shadow maps under a live session says why', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const { backend, lit } = await drawnShadows(true)
  assert.equal(lit.length, 1, 'the frame is lit without them')
  assert.match(String(lit[0].unavailable), /virtual shadow maps unavailable: .*out of memory/)
  assert.equal(backend.metrics().shadowVsmLights, null, 'no maps half made')
  await backend.dispose()
})
