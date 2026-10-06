import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeWaterPass } from './pass.ts'
import { createWaterPass } from './waterPass.ts'
import { prepared, replay, targets } from './pass.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { waterSurfaceTargets } from './surfaceTargets.ts'
import { WATER_COMPOSITE_PASS, WATER_SURFACE_PASS } from './passLabels.ts'

/** A water pass on the recording replay (`pass.fixture.ts`), its bounds opened, and its restore
 *  pipeline. */
async function recorded() {
  const { blendState, gpu } = prepared()
  targets(gpu)
  const fake = fakeDevice()
  blendState.water = await createWaterPass(fake.device, {} as never, {} as never, true, false)
  const restore = fake.renderPipelines.find((p) => p.fragment?.entryPoint === 'restore_fs')!
  const bounds = blendState.waterBounds
  bounds.active = true
  return { ...replay(blendState, gpu), bounds, restore }
}

/** The lit image's copy from (`at`, `at`), `side` texels square. */
const hdrCopy = (at: number, side: number) => ({
  a: { texture: {}, origin: { x: at, y: at } },
  b: { texture: {}, origin: { x: at, y: at } },
  size: { width: side, height: side },
})

const CASES = [
  { surface: [2, 3, 6, 7], backdrop: [1, 1, 8, 8], rect: [2, 3, 4, 4], copy: hdrCopy(1, 7) },
  { surface: [0, 0, 8, 8], backdrop: [0, 0, 8, 8], rect: [0, 0, 8, 8], copy: hdrCopy(0, 8) },
  // Bounds opened but left empty by the cull cover the full target, never a negative rect.
  { surface: [8, 8, 0, 0], backdrop: [8, 8, 0, 0], rect: [0, 0, 8, 8], copy: hdrCopy(0, 8) },
]

test('the surface pass restores the opaque depth itself, scissored, before any surface', async () => {
  const r = await recorded()
  assert.deepEqual(r.restore.depthStencil, {
    format: 'depth32float',
    depthCompare: 'always',
    depthWriteEnabled: true,
  })
  // The surface pass's colour targets, none written: the draw is that pass's.
  assert.deepEqual(
    [...r.restore.fragment!.targets],
    waterSurfaceTargets(true).map((target) => ({ ...target, writeMask: 0 })),
  )
  for (const { surface, backdrop, rect, copy } of CASES) {
    r.passes.length = r.copies.length = 0
    r.bounds.surface.set(surface)
    r.bounds.backdrop.set(backdrop)
    const drawCalls = r.rt.run.gpuDrawCalls
    assert.equal(encodeWaterPass(r.rt, r.encoder), true)
    assert.deepEqual(r.copies, [copy], 'the lit image alone')
    assert.deepEqual(
      r.passes.map((p) => p.label),
      [WATER_SURFACE_PASS, WATER_COMPOSITE_PASS],
    )
    assert.deepEqual(
      r.passes.map((p) => p.scissors),
      [[rect], [rect]],
    )
    const [{ descriptor, commands }] = r.passes
    const depth = descriptor.depthStencilAttachment!
    assert.deepEqual(
      [depth.depthLoadOp, depth.depthClearValue, depth.depthStoreOp],
      ['clear', 0, 'store'],
    )
    assert.deepEqual(commands.slice(0, 3), ['pipeline:restore_fs', 'draw', 'pipeline:fsWater'])
    assert.ok(commands.slice(3).includes('indirect'), 'the surfaces draw after the restore')
    assert.equal([...descriptor.colorAttachments][3]!.loadOp, 'clear', 'word clear full-target')
    // The surface draw, the restore draw and the composite.
    assert.equal(r.rt.run.gpuDrawCalls - drawCalls, 3)
  }
})
