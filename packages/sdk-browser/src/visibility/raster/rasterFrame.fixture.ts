import { createGpuRaster } from './raster.ts'
import type { GpuRasterInput } from './types.ts'
import { RASTER_PASS_MAIN, RASTER_PASS_POST } from './contract.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

/** A raster over a fake device, whose split holds the plane's code or not (`clipping`), and an image
 *  that asks the tessellation or not. */
export function rasterOf(tessellating: boolean, clipping = false) {
  const f = fakeDevice({
    limits: {
      maxStorageBufferBindingSize: 134217728,
      maxBufferSize: 268435456,
      maxComputeWorkgroupsPerDimension: 65535,
    } as unknown as GPUSupportedLimits,
  })
  const device = f.device as unknown as GPUDevice
  const raster = createGpuRaster(device, 64, 64, 4096, clipping)
  const buffer = (label: string) =>
    device.createBuffer({ label, size: 4096, usage: 0x80 | 0x40 | 0x8 })
  const input = {
    indices: buffer('indices'),
    positions: buffer('positions'),
    pages: buffer('pages'),
    uniform: buffer('uniform'),
    postUniformOffset: 256,
    uvs: buffer('uvs'),
    textures: { data: { views: [{}, {}, {}], pages: { buffer: buffer('data pages') } } },
    sampler: {},
    material: {},
    normals: {},
    items: buffer('items'),
    pageRows: 3,
    ...(tessellating && {
      tessellation: {
        displaced: { ints: new Uint32Array(24), version: 1 },
        view: { projection: 1.7, height: 64, threshold: 1 },
        settings: { tessellationDicingRate: 2, tessellationMaxPatchesPerGroup: 5 },
        // A cut in one pass: no previous pyramid, nothing the patches are tested against.
        occlusion: {
          previous: undefined,
          current: () => undefined,
          uniforms: { depthMap: [0.1, 0] },
        },
      },
    }),
  } as unknown as GpuRasterInput
  const encoder = device.createCommandEncoder()
  /** The kernels dispatched, in order, from the pass `label` on. */
  const frame = () => {
    raster.encodeBinning(encoder, input, RASTER_PASS_MAIN)
    raster.encodeDepth(encoder, RASTER_PASS_MAIN)
    raster.encodeBinning(encoder, input, RASTER_PASS_POST)
    raster.encodeIds(encoder, input, [64, 64], true)
    return f.dispatches.map((d) => d.entryPoint)
  }
  return { f, device, raster, frame, input }
}
