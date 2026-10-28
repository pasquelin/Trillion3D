// A lobe that enters a lit scene — a cluster wearing a lobed surface, a lobed translucent item — asks for its pass's lobe code at the frame's entry (`askLobedPrograms`), and
// the frame is held while it compiles (`pipelinesCompiling`, the frame gate's `deviceAnswering`):
// no image of a lobed surface is drawn unlit or without its lobes. Once landed, the frame is lit
// with the lobes.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import { createResidentSurfaces } from '../../geometry/clusters/surfaces.ts'
import { askLobedPrograms } from './contractLight.ts'
import { lobelessLighting } from '../../lighting/deferred/recorder.fixture.ts'
import { createForwardVariants } from '../../lighting/deferred/forwardVariants.ts'
import { FULL_CONTRACT, variantLabel } from '../../lighting/deferred/contractCuts.ts'
import {
  pipelinesCompiling,
  pipelinesSettled,
  track,
} from '../../lighting/deferred/compileLedger.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** Resident clusters wearing one surface, lobed or not. */
const clustersOf = (lobed: boolean) => {
  const surfaces = createResidentSurfaces()
  surfaces.set(0, surfaceOf(G.physicalSurface(lobed ? { clearcoat: 1 } : { roughness: 0.5 })))
  return { surfaces }
}

/** A lit runtime of these parts: what `askLobedPrograms` reads. */
const runtime = (parts: {
  deferred?: object
  clusters?: object
  blendPipelines?: object
  blendState?: object
}) =>
  ({
    context: {},
    lights: { store: { unlit: false } },
    // No bounce asked: `askLobedPrograms` reads `bounce.wanted` to compile the bounce's lit program beside the probes' rigging.
    bounce: { wanted: false },
    gpu: { deferred: parts.deferred },
    vis: { blendPipelines: parts.blendPipelines },
    layout: { clusters: parts.clusters ?? clustersOf(false) },
    blendState: { lobed: false, ...parts.blendState },
  }) as unknown as WebgpuPagesRuntime

test('a cluster that wears a lobe holds the frame until the lobed resolve lands, then lights it', async () => {
  const { device, lighting, labels, draw } = await lobelessLighting()
  assert.equal(pipelinesCompiling(device), false)
  // Lobeless clusters ask nothing.
  askLobedPrograms(runtime({ deferred: lighting }), device)
  assert.equal(pipelinesCompiling(device), false)
  askLobedPrograms(runtime({ deferred: lighting, clusters: clustersOf(true) }), device)
  assert.equal(pipelinesCompiling(device), true, 'the frame is held')
  await pipelinesSettled(device, true)
  assert.equal(pipelinesCompiling(device), false)
  // The frame the hold released is lit with the lobes, never unlit nor lobeless.
  assert.equal(draw({ lobeless: false }), true)
  assert.deepEqual(labels(), ['DIRECT_LOBELESS', 'DIRECT'])
  // Landed, the next frames ask nothing.
  askLobedPrograms(runtime({ deferred: lighting, clusters: clustersOf(true) }), device)
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
  // What `askBlendReach` asks at the frame's entry: the program of the frame's key.
  track(device, programs.awaited(FULL_CONTRACT, true), true)
  assert.equal(pipelinesCompiling(device), true, 'the frame is held')
  // No stand-in lacking the lobe code is lent meanwhile.
  assert.equal(programs.pick(FULL_CONTRACT, true), undefined)
  open()
  await pipelinesSettled(device, true)
  assert.equal(pipelinesCompiling(device), false)
  // The label is the blend program's: a translucent program holds no contact code, so its key says contactless.
  assert.equal(programs.pick(FULL_CONTRACT, true), 'LIT_CONTACTLESS')
})
