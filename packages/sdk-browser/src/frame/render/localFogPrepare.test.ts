// What the frame keeps for the local fog volumes between images (`./encodeLocalFog.ts`, `./localFogGpu.ts`),
// on the kit's device: the lists' buffer kept while it holds the grid, let go with the last volume even in the
// image the light buffer is remade, the passes' refusals to compile said to the diagnostics last given.
import { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatchedEntries } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { encodeLocalFogSky } from './encodeLocalFog.ts'
import { fogReadOf } from './localFogGpu.ts'
import { at, harness, later, lightBufferOf, sunStore } from './localFogView.fixture.ts'

/** A list of the phases a runtime's diagnostics heard, and the diagnostics that hear them. */
function listener() {
  const heard: string[] = []
  return { heard, diag: { diagnosticFailure: (phase: string) => heard.push(phase) } }
}

test('the lists’ buffer is kept while it holds the grid and is not more than twice what it needs: a finer tile side and back does not make it, nor the groups that name it, again', async () => {
  const { gpu, rt, volumes, image } = harness(sunStore())
  const tilesOf = () => rt.gpu.localFog!.tiles!
  volumes.add({ id: 'a', matrix: at(0, 2, -12) })
  image([0, 2, 0])
  await later()
  // 160 × 90 pixels in tiles of 128: two across, one down, nine words a tile; 32 volumes' flags.
  image([0, 2, 0])
  const coarse = tilesOf()
  assert.equal(coarse.size, (2 * 9 + 32) * 4)
  // Tiles of 64: three across, two down.
  Object.assign(rt.context, { localFogVolumeTileSize: 64 })
  image([0, 2, 0])
  const fine = tilesOf()
  assert.equal(fine.size, (3 * 2 * 9 + 32) * 4, 'the grid needs more: made again')
  assert.notEqual(fine, coarse)
  // Back to tiles of 128: the buffer holds the grid, and is less than twice what it needs.
  Object.assign(rt.context, { localFogVolumeTileSize: 128 })
  const named = fogReadOf(rt)
  const destroyed = gpu.destroyed.length
  image([0, 2, 0])
  assert.equal(tilesOf(), fine, 'kept')
  assert.equal(fogReadOf(rt), named, 'the programs keep their groups')
  assert.equal(gpu.destroyed.length, destroyed, 'nothing let go')
  assert.deepEqual(
    dispatchedEntries(gpu.dispatches),
    ['localCullMain'],
    'and the lists are written',
  )
  // Tiles of 512, one for the view: the buffer is more than twice what it needs, and is made smaller.
  Object.assign(rt.context, { localFogVolumeTileSize: 512 })
  image([0, 2, 0])
  assert.equal(tilesOf().size, (9 + 32) * 4)
  assert.notEqual(tilesOf(), fine)
})

test('the last volume taken away in the image the light buffer is remade: the lists are let go and the culling does not run', async () => {
  const { gpu, rt, volumes, image } = harness(sunStore())
  volumes.add({ id: 'a', matrix: at(0, 2, -12) })
  image([0, 2, 0])
  await later()
  image([0, 2, 0])
  assert.ok(rt.gpu.localFog!.tiles)
  assert.equal(rt.gpu.localFog!.plan.active, true)
  volumes.remove('a')
  // The new buffer holds no volume: nothing in it says the view drew one.
  Object.assign(rt.lights, { buffer: lightBufferOf(gpu.device) })
  image([0, 2, 0])
  assert.equal(rt.gpu.localFog!.tiles, undefined, 'the lists are let go')
  assert.deepEqual(
    [rt.gpu.localFog!.plan.active, rt.gpu.localFog!.plan.count],
    [false, 0],
    'and the plan is none',
  )
  assert.deepEqual(dispatchedEntries(gpu.dispatches), [], 'no culling over an empty block')
})

test('a refusal to compile a pass is said, to the diagnostics of the runtime that last asked for it, and the volumes are still drawn', async () => {
  const { gpu, rt, volumes, said, image } = harness(sunStore(), undefined, {
    failCompute: true,
  })
  const [first, last] = [listener(), listener()]
  Object.assign(rt, { diag: first.diag })
  volumes.add({ id: 'a', matrix: at(0, 2, -12) })
  image([0, 2, 0])
  // Another runtime of the device asks next: it is the one to hear.
  Object.assign(rt, { diag: last.diag })
  image([0, 2, 0])
  Object.assign(rt.gpu, { device: gpu.device })
  const steps = new ComputeRun().begin(gpu.device.createCommandEncoder())
  encodeLocalFogSky(rt, gpu.device, steps)
  steps.end()
  await later()
  assert.deepEqual([first.heard, said], [[], []], 'the first runtime hears nothing')
  assert.ok(last.heard.length > 0)
  assert.deepEqual(
    [...new Set(last.heard)].sort(),
    ['fog-local-cull-failed', 'fog-local-sky-failed'],
    'both passes are said',
  )
  assert.equal(rt.gpu.localFog!.plan.count, 1, 'the volume is still drawn, with no lists')
  assert.equal(rt.gpu.localFog!.tiles, undefined)
})
