// The fog volume's work on the kit's device (`./fog/gpu.ts`): its passes dispatched, its history
// kept and refused, and the cubemap's texture, its levels written (`./fog/cubemapGpu.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { toHalf } from '../../../math/src/float/half.ts'
import { resolveFogCubemap } from '../../../sdk-core/src/scene/core/fogCubemap.ts'
import { installGpuDeviceLedger } from '../gpu/core/deviceLedger.ts'
import { FOG_VOLUME_FRAME_AT } from './fog/layout.ts'
import { createFogVolumeGpu, type FogVolumeInputs } from './fog/gpu.ts'
import { createFogStandIns } from './fog/read.ts'
import { createFogCubemap } from './fog/cubemapGpu.ts'
import { CAM, image } from './fogVolumeRun.fixture.ts'
import { fakeHizDepth } from './shadows/vsm/hizDepth.fixture.ts'

/** What an image gives the volume's passes on the kit's device: the image of the test camera at
 *  the settings `settings` names, a depth texture, the pyramid where `hiz`, the light buffer, its
 *  lists and the shadow maps. */
function volumeInput(
  gpu: ReturnType<typeof fakeDevice>,
  settings: Parameters<typeof image>[2] = {},
  hiz = true,
): FogVolumeInputs {
  const buffer = () =>
    gpu.device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM })
  const { previous, grid, resource, rebuildSamples, skipHidden, ...rest } = image(
    CAM,
    true,
    settings,
  )
  void [previous, grid, resource, rebuildSamples, skipHidden]
  return {
    ...rest,
    allocated: [160, 90],
    hiz: hiz ? fakeHizDepth : undefined,
    depth: gpu.device
      .createTexture({
        size: { width: 160, height: 90 },
        format: 'depth32float',
        usage: GPUTextureUsage.TEXTURE_BINDING,
      })
      .createView(),
    lights: buffer(),
    tiles: buffer(),
    vsm: {
      pageTable: buffer(),
      projectionData: buffer(),
      uniforms: buffer(),
      pool: buffer(),
      view: buffer(),
    },
  }
}

/** A volume on the kit's device whose pipelines are compiled. */
async function started(gpu = fakeDevice()) {
  const failed: unknown[] = []
  const volume = createFogVolumeGpu(
    gpu.device,
    (e) => failed.push(e),
    createFogStandIns(gpu.device).read,
  )
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(volume.ready && failed.length === 0)
  return { gpu, volume }
}

test('the volume’s passes, dispatched on the device of the tests: three, two without the furthest depth, none off', async () => {
  const { gpu, volume } = await started()
  const encoder = gpu.device.createCommandEncoder()
  const view = volume.encode(encoder, volumeInput(gpu))
  assert.ok(view, 'the integrated volume')
  assert.deepEqual(
    gpu.dispatches.map((d) => d.entryPoint),
    ['furthestMain', 'scatterMain', 'integrateMain'],
  )
  // The grid of 8-pixel cells and 128 slices at the quality `high`, over 160 × 90: three volumes
  // of 20 × 12 × 128 half-float cells (the scatter twice, the integral), two planes of 20 × 12.
  const cells = gpu.textures.filter((t) => t.dimension === '3d' && t.width === 20)
  assert.deepEqual(
    cells.map((t) => [t.width, t.height, t.depthOrArrayLayers]),
    Array(3).fill([20, 12, 128]),
  )
  assert.equal(
    gpu.textures.filter((t) => t.format === 'r32float' && t.width === 20 && t.height === 12).length,
    2,
  )
  // Without the pyramid, or with the setting off, no cell is held hidden: no furthest-depth pass.
  for (const input of [
    volumeInput(gpu, {}, false),
    volumeInput(gpu, { volumetricFogSkipHidden: false }),
  ]) {
    gpu.dispatches.length = 0
    volume.encode(encoder, input)
    assert.deepEqual(
      gpu.dispatches.map((d) => d.entryPoint),
      ['scatterMain', 'integrateMain'],
    )
  }
  // Off, nothing is built; seen through an orthographic camera, the same three passes are, and the
  // frame says the view is one (`depthMap.z`).
  gpu.dispatches.length = 0
  assert.equal(volume.encode(encoder, volumeInput(gpu, { volumetricFogQuality: 'off' })), undefined)
  assert.equal(gpu.dispatches.length, 0)
  const ortho = volumeInput(gpu)
  ortho.camera = { ...ortho.camera, perspective: false }
  assert.ok(volume.encode(encoder, ortho))
  assert.deepEqual(
    gpu.dispatches.map((d) => d.entryPoint),
    ['furthestMain', 'scatterMain', 'integrateMain'],
  )
  assert.equal(volume.frame[FOG_VOLUME_FRAME_AT.depthMap + 2], 1)
  volume.dispose()
})

test('every resource a pass’s group names exists: a real device refuses a group with an undefined one', async () => {
  const { gpu, volume } = await started()
  const before = gpu.bindGroups.length
  volume.encode(gpu.device.createCommandEncoder(), volumeInput(gpu))
  const made = gpu.bindGroups.slice(before)
  assert.equal(made.length, 3, 'one group a program')
  for (const group of made)
    for (const entry of group.entries)
      assert.notEqual(
        entry.resource,
        undefined,
        `binding ${entry.binding} of ${group.layout.label}`,
      )
  volume.dispose()
})

test('the frame is sent by what changed: an image whose frame is the last one’s sends nothing', async () => {
  const { gpu, volume } = await started()
  const encoder = gpu.device.createCommandEncoder()
  const sent = () =>
    gpu.writes.filter((w) => (w.buffer as { label?: string }).label === 'Trillion3D fog frame')
      .length
  volume.encode(encoder, volumeInput(gpu))
  volume.encode(encoder, volumeInput(gpu))
  const before = sent()
  assert.ok(before > 0, 'the first images are sent')
  volume.encode(encoder, volumeInput(gpu))
  assert.equal(sent(), before, 'the third is the second, word for word')
  volume.encode(encoder, { ...volumeInput(gpu), frameIndex: 9 })
  assert.equal(sent(), before + 1, 'a new image number is sent')
  volume.dispose()
})

test('the history: kept from an image to the next, refused after a cut or a change of what is held hidden', async () => {
  const { gpu, volume } = await started()
  const encoder = gpu.device.createCommandEncoder()
  const weight = () => volume.frame[FOG_VOLUME_FRAME_AT.blend]
  volume.encode(encoder, volumeInput(gpu))
  assert.equal(weight(), 0, 'the first image has none')
  volume.encode(encoder, volumeInput(gpu))
  assert.equal(weight(), Math.fround(0.9), 'the second reads the first')
  volume.encode(encoder, { ...volumeInput(gpu), cut: true })
  assert.equal(weight(), 0, 'a camera cut')
  volume.encode(encoder, volumeInput(gpu, {}, false))
  assert.equal(weight(), 0, 'cells held hidden before, not now')
  volume.encode(encoder, volumeInput(gpu, {}, false))
  assert.equal(weight(), Math.fround(0.9), 'as before, kept again')
  // A view drawn smaller than the targets — a dynamic resolution — keeps the textures and the history,
  // its cells fewer and the dispatches with them; the frame holds both grids.
  const smaller = volumeInput(gpu, {}, false)
  smaller.camera = { ...smaller.camera, width: 120, height: 66 }
  const textures = gpu.textures.length
  gpu.dispatches.length = 0
  volume.encode(encoder, smaller)
  assert.equal(weight(), Math.fround(0.9), 'the history kept')
  assert.equal(gpu.textures.length, textures, 'no texture made')
  const at = FOG_VOLUME_FRAME_AT
  const field = (f: number) => Array.from(volume.frame.subarray(f, f + 4))
  assert.deepEqual(field(at.grid), [15, 9, 128, 8], 'the cells the view uses')
  assert.deepEqual(field(at.texture), [20, 12, 128, 8], 'the cells the textures hold')
  // The groups over the view's cells alone: 15 × 9 cells by 4 × 4 threads, then by 8 × 8.
  assert.deepEqual(
    gpu.dispatches.map((d) => [d.direct, d.rows]),
    [
      [4, 3],
      [2, 2],
    ],
  )
  // Targets made for another size make the textures again, and the history starts over.
  const wide = volumeInput(gpu, {}, false)
  wide.allocated = [320, 90]
  volume.encode(encoder, wide)
  assert.equal(weight(), 0, 'another textures')
  volume.dispose()
})

test('the volume’s memory is the ledger’s to admit: no room, no volume and no refusal of the session; room, it is built', async () => {
  const gpu = fakeDevice()
  const box = { limit: 100_000 }
  const ledger = installGpuDeviceLedger(gpu.device, { limit: () => box.limit })
  const { volume } = await started(gpu)
  const encoder = gpu.device.createCommandEncoder()
  // Three volumes of 20 × 12 × 128 half-float cells are some 740 kB: the analytic fog stays.
  assert.equal(volume.encode(encoder, volumeInput(gpu)), undefined)
  assert.equal(gpu.dispatches.length, 0)
  assert.equal(ledger.refusal, undefined, 'the volume is an optional allocation')
  assert.equal(volume.bytes, 0)
  box.limit = 1e9
  assert.ok(volume.encode(encoder, volumeInput(gpu)), 'built once the room is there')
  assert.ok(volume.bytes > 700_000)
  volume.dispose()
})

/** The half floats a write of the queue holds. */
const halves = (data: ArrayBufferView) =>
  Array.from(new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2))

test('the cubemap’s texture: its sharpest level and its smallest written, the smallest the face means', () => {
  const gpu = fakeDevice()
  // Two texels across a face: face f, texel k holds (f + k / 10, 0.5, 2).
  const texels = Float32Array.from({ length: 72 }, (_, i) => {
    const [face, k, c] = [Math.floor(i / 12), Math.floor(i / 3) % 4, i % 3]
    return [face + k / 10, 0.5, 2][c]
  })
  const made = createFogCubemap(gpu.device, resolveFogCubemap({ size: 2, texels }))
  const texture = gpu.textures.find((t) => t.label === 'Trillion3D fog cubemap')!
  assert.deepEqual(
    [texture.format, texture.depthOrArrayLayers, texture.mipLevelCount],
    ['rgba16float', 6, 2],
  )
  const level = (mip: number) =>
    gpu.textureWrites.filter((w) => w.destination.mipLevel === mip).sort((a, b) => a.seq - b.seq)
  const [sharp, smallest] = [level(0), level(1)]
  assert.equal(sharp.length, 6)
  assert.equal(smallest.length, 6)
  const rgba = (r: number, g: number, b: number) => [toHalf(r), toHalf(g), toHalf(b), toHalf(1)]
  sharp.forEach((write, face) => {
    assert.equal(write.destination.origin.z, face)
    assert.deepEqual(
      halves(write.data),
      Array.from({ length: 4 }, (_, k) => rgba(face + k / 10, 0.5, 2)).flat(),
    )
  })
  // The smallest level: the mean of the four texels of a face, face + 0.15, one texel a face.
  smallest.forEach((write, face) => {
    assert.equal(write.destination.origin.z, face)
    assert.deepEqual(halves(write.data), rgba(face + 0.15, 0.5, 2))
  })
  made.destroy()
  assert.ok(gpu.destroyed.includes(texture))
})

test('the cubemap’s texels past what a half float holds are held to it, never an infinity', () => {
  const gpu = fakeDevice()
  const texels = new Float32Array(6 * 3).fill(2e5)
  createFogCubemap(gpu.device, resolveFogCubemap({ size: 1, texels }))
  const [first] = gpu.textureWrites
  assert.deepEqual(halves(first.data).slice(0, 3), Array(3).fill(toHalf(65504)))
})
