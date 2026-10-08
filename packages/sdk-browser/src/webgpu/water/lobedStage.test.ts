// A transmissive surface that carries an anisotropic or clear-coat lobe draws through the water's
// lobed stage (`lobedStage.ts`) once it compiled and the lobes target is full-size: its surface
// pass writes that target too — after the water word, before the feedback, as the stage and its
// depth restore list their targets —, and the stage's own entry draws. Any other image, and every
// image before the stage landed — held at the frame gate meanwhile (`lobedHold.test.ts`) —, draws
// the plain stage, the lobes target left alone: no frame compiles it. Replayed on the recording
// encoder (`pass.fixture.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeWaterPass } from './pass.ts'
import { createWaterPass } from './waterPass.ts'
import { prepared, replay, targets } from './pass.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { waterSurfaceTargets } from './surfaceTargets.ts'

test('a lobed transmissive surface draws the lobed stage into the lobes target', async () => {
  const { blendState, gpu } = prepared()
  targets(gpu)
  const fake = fakeDevice()
  blendState.water = await createWaterPass(fake.device, {} as never, {} as never, true, false)
  const r = replay(blendState, gpu)
  const surfaces = gpu.surfaces as unknown as { lobesView: GPUTextureView; lobes: object }
  const cases: [boolean, boolean][] = [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ]
  for (const ready of [false, true]) {
    if (ready) await blendState.water.lobed.prepare()
    else
      assert.equal(blendState.water.lobed.get(), undefined, 'nothing compiled before it is asked')
    for (const [waterLobed, hasLobes] of cases) drawn(waterLobed, hasLobes, ready)
  }
  function drawn(waterLobed: boolean, hasLobes: boolean, ready: boolean) {
    blendState.waterLobed = waterLobed
    // The lobes target holds every pixel of the 8×8 frame, or is its 1×1 stand-in.
    surfaces.lobes = hasLobes ? { width: 8, height: 8 } : { width: 1, height: 1 }
    r.passes.length = 0
    assert.equal(encodeWaterPass(r.rt, r.encoder, true, {}), true)
    const lobed = ready && waterLobed && hasLobes
    const [{ writes, commands }] = r.passes
    // The three surfaces, the word, the lobes target where lobed, the feedback.
    assert.equal(writes.length, lobed ? 6 : 5)
    assert.equal(writes[4] === surfaces.lobesView, lobed, `${waterLobed}, ${hasLobes}`)
    assert.ok(!writes.includes(surfaces.lobesView) || lobed)
    const entry = lobed ? 'fsWaterLobed' : 'fsWater'
    assert.deepEqual(commands.slice(0, 3), ['pipeline:restore_fs', 'draw', `pipeline:${entry}`])
  }
  // The lobed stage and its restore list the targets its pass attaches, the restore writing none.
  const lobedTargets = waterSurfaceTargets(true, true)
  const made = (entry: string) =>
    fake.renderPipelines.filter((pipeline) => pipeline.fragment?.entryPoint === entry)
  assert.equal(made('fsWaterLobed').length, 3, 'its three culls')
  for (const pipeline of made('fsWaterLobed'))
    assert.deepEqual([...pipeline.fragment!.targets], lobedTargets)
  assert.ok(
    made('restore_fs').some(
      (pipeline) =>
        JSON.stringify([...pipeline.fragment!.targets]) ===
        JSON.stringify(lobedTargets.map((target) => ({ ...target, writeMask: 0 }))),
    ),
  )
})
