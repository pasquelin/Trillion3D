// A lobe that enters a lit scene — a row wearing a lobed surface, a lobed blend item, a lobed
// transmissive item — asks for its pass's lobe code at the frame's entry (`askLobedPrograms`), and
// the frame is held while it compiles (`pipelinesCompiling`, the frame gate's `deviceAnswering`):
// no image of a lobed surface is drawn unlit or without its lobes. Once landed, the frame is lit
// with the lobes.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../../page/surface.ts'
import { askLobedPrograms } from './contractLight.ts'
import { createDeferredLighting } from '../../../lighting/deferred/deferred.ts'
import { recorder } from '../../../lighting/deferred/recorder.fixture.ts'
import { createForwardVariants } from '../../../lighting/deferred/forwardVariants.ts'
import { FULL_CONTRACT, variantLabel } from '../../../lighting/deferred/contractCuts.ts'
import { pipelinesCompiling, pipelinesSettled } from '../../../lighting/deferred/compileLedger.ts'
import { createWaterPass } from '../../water/waterPass.ts'
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** Rows wearing one surface, lobed or not. */
const rowsOf = (lobed: boolean) => ({
  packedRecs: [
    { material: surfaceOf(G.physicalSurface(lobed ? { clearcoat: 1 } : { roughness: 0.5 })) },
  ],
  packedCount: 1,
  rowWrites: 0,
  tableEpoch: 0,
})

/** A lit runtime of these parts: what `askLobedPrograms` reads. */
const runtime = (parts: {
  deferred?: object
  rows?: object
  blendPipelines?: object
  blendState?: object
}) =>
  ({
    lights: { store: { unlit: false } },
    gpu: { deferred: parts.deferred },
    vis: { blendPipelines: parts.blendPipelines },
    layout: { rows: parts.rows ?? rowsOf(false) },
    blendState: { lobed: false, waterLobed: false, ...parts.blendState },
  }) as unknown as WebgpuPagesRuntime

test('a row that wears a lobe holds the frame until the lobed resolve lands, then lights it', async () => {
  const { device } = fakeDevice()
  const lighting = await createDeferredLighting(device)
  const { labels, draw } = recorder(lighting)
  draw({ lobeless: true })
  await lighting.settle()
  draw({ lobeless: true })
  assert.equal(pipelinesCompiling(device), false)
  // Lobeless rows ask nothing.
  askLobedPrograms(runtime({ deferred: lighting }), device)
  assert.equal(pipelinesCompiling(device), false)
  askLobedPrograms(runtime({ deferred: lighting, rows: rowsOf(true) }), device)
  assert.equal(pipelinesCompiling(device), true, 'the frame is held')
  await pipelinesSettled(device, true)
  assert.equal(pipelinesCompiling(device), false)
  // The frame the hold released is lit with the lobes, never unlit nor lobeless.
  assert.equal(draw({ lobeless: false }), true)
  assert.deepEqual(labels, ['DIRECT_LOBELESS_LIGHTING', 'DIRECT_LIGHTING'])
  // Landed, the next frames ask nothing.
  askLobedPrograms(runtime({ deferred: lighting, rows: rowsOf(true) }), device)
  assert.equal(pipelinesCompiling(device), false)
  lighting.dispose()
})

test('lobed blend items hold the frame until a lobed program lands, then are lit by it', async () => {
  const device = {} as GPUDevice
  let open = () => {}
  const gate = new Promise<void>((resolve) => (open = resolve))
  const programs = await createForwardVariants(
    async (key) => {
      if (!key.lobeless) await gate
      return `LIT${variantLabel(key)}`
    },
    { precompile: true, key: { ...FULL_CONTRACT, lobeless: true } },
  )
  const blendPipelines = { lobedAwaited: () => programs.awaited(FULL_CONTRACT) }
  const rt = runtime({ blendPipelines, blendState: { lobed: true } })
  askLobedPrograms(rt, device)
  assert.equal(pipelinesCompiling(device), true, 'the frame is held')
  // What the held frame would have drawn: the lobeless twin.
  assert.equal(programs.pick(FULL_CONTRACT, true), 'LIT_LOBELESS')
  open()
  await pipelinesSettled(device, true)
  assert.equal(pipelinesCompiling(device), false)
  assert.equal(programs.pick(FULL_CONTRACT, true), 'LIT')
})

test('a lobed transmissive item holds the frame until its lobed stage lands', async () => {
  const fake = fakeDevice()
  let open = () => {}
  const gate = new Promise<void>((resolve) => (open = resolve))
  const module = {} as GPUShaderModule
  const lobes = { module: () => gate.then(() => module), now: false }
  const water = await createWaterPass(
    fake.device,
    module,
    {} as never,
    true,
    false,
    undefined,
    undefined,
    lobes,
  )
  const rt = runtime({ blendState: { waterLobed: true, water } })
  askLobedPrograms(rt, fake.device)
  assert.equal(pipelinesCompiling(fake.device), true, 'the frame is held')
  assert.equal(water.lobed.get(), undefined)
  open()
  await pipelinesSettled(fake.device, true)
  assert.equal(pipelinesCompiling(fake.device), false)
  assert.ok(water.lobed.get(), 'the lobed stage draws the released frame')
  // Landed, the next frames ask nothing.
  askLobedPrograms(rt, fake.device)
  assert.equal(pipelinesCompiling(fake.device), false)
})
