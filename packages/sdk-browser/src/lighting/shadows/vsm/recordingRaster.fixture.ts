import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { replayWrites } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { uniformStride } from '../../../session/memory/pools.ts'
import { createVsmResources } from './resources.ts'
import { encodeVsmRender, type VsmRenderScene } from './render/renderPass.ts'
import { VSM_RENDER_PARAMS } from './render/renderParamsWgsl.ts'
import { emptyRowSpheres } from './rows/rowPageBound.fixture.ts'
import type { VsmBoundLight } from './rows/rowPageBound.ts'

/** What a raster pass of `rowCount` rows under one sun is encoded with, on the kit's `device`: one
 *  of its encoders, the scene on one tiny buffer, and the sun. */
export function recordingRaster(device: GPUDevice, rowCount: number) {
  const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE })
  const scene: VsmRenderScene = {
    rowCount,
    ...{ pageTable: buffer, spheres: buffer, mobility: buffer, rowLods: buffer },
    pageLayout: {} as GPUBindGroupLayout,
    pageGroup: {} as GPUBindGroup,
    rowSpheres: emptyRowSpheres(),
    multipassViews: true,
    camera: {
      ...{ eye: [0, 0, 0], view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      ...{ focalPixels: 100, near: 0.1, perspective: true, threshold: 1 },
    },
  }
  const lights = [{ kind: 'directional' as const, firstId: 0, count: 1 }]
  return { encoder: device.createCommandEncoder(), scene, lights }
}

/** A device whose dispatches have 500 rows (`maxComputeWorkgroupsPerDimension`): the cull lists 500
 *  maps a pass at most, so a sun and 200 point lights, 1217 maps, take three passes. */
export const LOW_DISPATCH = { maxComputeWorkgroupsPerDimension: 500 }

/** The raster of 200 000 rows under a sun's 17 levels, `scene` over the recording one, encoded into
 *  `encoder` on `device`: what the encoding returned. */
export function encodeRows(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  scene: Partial<VsmRenderScene> = {},
) {
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const raster = recordingRaster(device, 200_000)
  const lights = [{ kind: 'directional' as const, firstId: 0, count: 17 }]
  return encodeVsmRender(encoder, res, { device, lights }, { ...raster.scene, ...scene })!
}

/** A sun's 17 clipmap levels, then `points` point lights of six faces, in the order of their ids. */
export function manyLights(points: number) {
  const lights: VsmBoundLight[] = [{ kind: 'directional', firstId: 0, count: 17 }]
  for (let i = 0; i < points; i++) lights.push({ kind: 'point', firstId: 17 + 6 * i, count: 6 })
  return lights
}

/** The parameter slots the raster wrote on the recording device `fake`, as its writes left them:
 *  the words of every slot, and the words a slot is apart. */
export function paramWords(fake: ReturnType<typeof fakeDevice>) {
  const buffer = fake.buffers.find((b) => b.label === 'vsm.render.params')!
  const words = new Uint32Array(buffer.size / 4)
  const writes = fake.writes.filter((w) => w.buffer === (buffer as unknown as GPUBuffer))
  replayWrites(words.buffer, writes)
  return { words, stride: uniformStride(fake.device.limits) / 4 }
}

/** The raster of 20 000 rows under `lights` — `scene` over the recording one, `limits` over the
 *  device's — encoded on a recording device: that device, what the encoding returned and the
 *  parameter slots it wrote, one record a slot (a chunk of each view pass). */
export function encodeLights(
  lights: VsmBoundLight[],
  scene: Partial<VsmRenderScene> = {},
  limits: Partial<GPUSupportedLimits> = {},
) {
  const fake = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27, ...limits },
  })
  const { device } = fake
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const raster = recordingRaster(device, 20_000)
  const frame = { device, lights },
    drawn = { ...raster.scene, ...scene }
  const stats = encodeVsmRender(raster.encoder, res, frame, drawn)!
  const passes = fake.dispatches.filter((d) => d.entryPoint === 'vsmRenderViews').length
  const { words, stride } = paramWords(fake)
  const slots = Array.from({ length: passes * stats.chunks }, (_, k) => {
    const word = (field: keyof typeof VSM_RENDER_PARAMS.at) =>
      words[k * stride + VSM_RENDER_PARAMS.at[field]]
    return {
      ...{ chunk: word('chunk'), chunkFirst: word('chunkFirst'), chunkCount: word('chunkCount') },
      ...{
        chunkRows: word('chunkRows'),
        viewFirst: word('viewFirst'),
        viewCount: word('viewCount'),
        lightCount: word('lightCount'),
      },
    }
  })
  return { fake, stats, passes, slots }
}
