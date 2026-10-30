// The lit program the frame waits for (`litProgramPending`): a session that compiled the toon table alone and leaves the toon holds its frames until the plain table lights, never an unlit flash;
// the tables a frame plans are decided once, at its entry (`planLitTables`).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeferredLighting } from '../../lighting/deferred/deferred.ts'
import { FULL_CONTRACT } from '../../lighting/deferred/contractCuts.ts'
import { holdToonProfile } from '../../lighting/toon/registry.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { settledRt, surface, view } from '../loop/hold.fixture.ts'
import {
  bounceViewOf,
  directLightResources,
  litProgramPending,
  pickKeyOf,
  planLitTables,
} from './contractLight.ts'

test('the toon leaving a session that compiled the toon table alone holds the frame for the plain table, then lights it', async () => {
  const { device } = fakeDevice()
  const rt = settledRt()
  Object.assign(rt.context, { toonUnifiedDiffuse: true })
  Object.assign(rt.run, { diagnostic: 'beauty' })
  const lighting = await createDeferredLighting(device, undefined, {
    precompile: true,
    bounce: false,
    key: { ...FULL_CONTRACT, lobeless: true },
    toon: true,
  })
  rt.gpu.deferred = lighting
  await lighting.litReady
  const record = { released: new Set<() => void>() }
  holdToonProfile(record, undefined, true)
  const bindFrame = () =>
    lighting.bind(surface, view(), view(), true, { ...directLightResources(rt) }, () => {})
  // The toon on: the toon table lights the frame, which waits for nothing.
  assert.equal(pickKeyOf(rt).toonUnified, true)
  bindFrame()
  await lighting.settle()
  bindFrame()
  assert.equal(lighting.litProgram?.toon, true, 'lit with the toon table’s program')
  assert.equal(litProgramPending(rt), undefined)
  // The toon leaves: the plain table was never compiled, the frame waits for it.
  for (const hook of record.released) hook()
  assert.equal(pickKeyOf(rt).toonUnified, false)
  const waiting = litProgramPending(rt)
  assert.ok(waiting, 'held for the plain program, not drawn unlit')
  assert.ok(litProgramPending(rt), 'and held on the next frame too')
  await waiting
  assert.equal(litProgramPending(rt), undefined, 'the plain program is lent')
  bindFrame()
  assert.equal(lighting.litProgram?.toon, false)
  assert.equal(litProgramPending(rt), undefined)
  lighting.dispose()
})

test('the tables a frame plans are decided once at its entry: the pick, the draw’s resources and the asks all read that decision until the next entry', () => {
  const rt = settledRt()
  const part = { light: { mobility: 'movable', castShadows: true } }
  Object.assign(rt, {
    distanceFields: { scene: { meshes: { count: 1 } }, skyLight: part, occlusion: {} },
  })
  Object.assign(rt.run, { diagnostic: 'beauty' })
  const hiz = { depth: () => ({}) }
  const sources = (on: boolean) => {
    Object.assign(rt.vis, { gpuHiz: on ? hiz : undefined })
    Object.assign(rt.gpu, {
      device: fakeDevice().device,
      surfaces: on
        ? { views: () => [{}, {}], lobes: { width: 1, height: 1 }, width: 2, height: 2 }
        : undefined,
    })
  }
  // No frame has entered: the state as it stands is read.
  sources(true)
  assert.equal(pickKeyOf(rt).skyPlanned, true)
  sources(false)
  assert.equal(pickKeyOf(rt).skyPlanned, false)
  // The frame enters with its sources, then loses them before the draw: the program it waited for is the one it binds.
  sources(true)
  planLitTables(rt)
  sources(false)
  assert.equal(pickKeyOf(rt).skyPlanned, true, 'the pick')
  assert.equal(directLightResources(rt).skyPlanned, true, 'the draw')
  planLitTables(rt)
  assert.equal(pickKeyOf(rt).skyPlanned, false, 'the next entry decides again')
  assert.equal(directLightResources(rt).skyPlanned, false)
})

test('pickKeyOf and the bounce view are pure reads: no program is asked and no compile starts', async () => {
  const { device, renderPipelines } = fakeDevice()
  const rt = settledRt()
  Object.assign(rt.run, { diagnostic: 'beauty' })
  const lighting = await createDeferredLighting(device)
  rt.gpu.deferred = lighting
  Object.assign(rt.lights.store, { lightingView: 'bounce' })
  const before = renderPipelines.length
  for (let i = 0; i < 3; i++) {
    const key = pickKeyOf(rt)
    assert.equal(bounceViewOf(rt, { ...key, bounceGrid: {} as GPUBuffer }), false)
  }
  await lighting.settle()
  assert.equal(renderPipelines.length, before, 'nothing compiled by the reads')
  lighting.dispose()
})
