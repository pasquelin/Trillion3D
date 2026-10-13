// The water pass drawn by the GPU's rectangle and gate: no scissor, no texture copy, no CPU
// rectangle — the backdrop copy dispatched from the verdict's arguments, the depth restore and the
// composite drawn on the rectangle's quad from its draw arguments (`argsWgsl.ts`, `quadWgsl.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeWaterPass } from './pass.ts'
import { createWaterPass } from './waterPass.ts'
import { prepared, replay, stepsOf, targets } from './pass.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { commandArgs } from '../../../../../tests/kit/gpu/fakeRenderPass.ts'
import { waterSurfaceTargets } from './surfaceTargets.ts'
import { VERDICT } from '../blend/verdictLayout.ts'
import { WATER_BACKDROP_PASS, WATER_COMPOSITE_PASS, WATER_SURFACE_PASS } from './passLabels.ts'

/** A water pass on the recording replay (`pass.fixture.ts`), its restore pipeline, the verdict
 *  its draws read, and the compute passes the frame's encoder recorded. */
async function recorded() {
  const { blendState, gpu } = prepared()
  targets(gpu)
  const fake = fakeDevice()
  blendState.water = await createWaterPass(fake.device, {} as never, {} as never, true)
  const restore = fake.renderPipelines.find((p) => p.fragment?.entryPoint === 'restore_fs')!
  const verdict = blendState.expand!.buffers.verdict
  return { ...replay(blendState, gpu), restore, verdict }
}

test('the surface pass restores the opaque depth on the GPU rectangle, before any surface', async () => {
  const r = await recorded()
  assert.deepEqual(r.restore.depthStencil, {
    format: 'depth32float',
    depthCompare: 'always',
    depthWriteEnabled: true,
  })
  assert.equal(r.restore.vertex.entryPoint, 'waterQuad', 'the rectangle quad, not a fullscreen one')
  // The surface pass's colour targets, none written: the draw is that pass's.
  assert.deepEqual(
    [...r.restore.fragment!.targets],
    waterSurfaceTargets(true).map((target) => ({ ...target, writeMask: 0 })),
  )
  const drawCalls = r.rt.run.gpuDrawCalls
  assert.equal(encodeWaterPass(r.rt, r.encoder), true)
  assert.deepEqual(r.textureCopies, [], 'no texture copy: its size would be the CPU’s')
  assert.deepEqual(
    r.passes.map((p) => p.label),
    [WATER_SURFACE_PASS, WATER_COMPOSITE_PASS],
  )
  for (const pass of r.passes)
    assert.deepEqual(commandArgs(pass.commands, 'setScissorRect'), [], `${pass.label}: no scissor`)
  const [surface, composite] = r.passes
  const depth = surface.depth!
  assert.deepEqual(
    [depth.depthLoadOp, depth.depthClearValue, depth.depthStoreOp],
    ['clear', 0, 'store'],
  )
  const steps = stepsOf(surface)
  assert.deepEqual(steps.slice(0, 3), ['pipeline:restore_fs', 'indirect', 'pipeline:fsWater'])
  assert.ok(steps.slice(3).includes('indirect'), 'the surfaces draw after the restore')
  assert.equal(surface.colors[3]!.loadOp, 'clear', 'word clear full-target')
  const quad = [r.verdict, VERDICT.quadArgs * 4]
  assert.deepEqual(commandArgs(surface.commands, 'drawIndirect')[0], quad, 'the gate’s instances')
  assert.deepEqual(commandArgs(composite.commands, 'drawIndirect'), [quad], 'the same quad')
  // The surface draw, the restore draw and the composite.
  assert.equal(r.rt.run.gpuDrawCalls - drawCalls, 3)
})

test('the backdrop freeze is a compute copy dispatched from the verdict, never sized by the CPU', async () => {
  const { blendState, gpu } = prepared()
  targets(gpu)
  const fake = fakeDevice()
  blendState.water = await createWaterPass(fake.device, {} as never, {} as never, true)
  const r = replay(blendState, gpu)
  const own = fakeDevice()
  const encoder = own.device.createCommandEncoder()
  assert.equal(encodeWaterPass(r.rt, encoder), true)
  const copy = own.computePasses.find((pass) => pass.label === WATER_BACKDROP_PASS)!
  assert.deepEqual(commandArgs(copy.commands, 'dispatchWorkgroupsIndirect'), [
    [blendState.expand!.buffers.verdict, VERDICT.copyArgs * 4],
  ])
  assert.deepEqual(commandArgs(copy.commands, 'dispatchWorkgroups'), [])
})
