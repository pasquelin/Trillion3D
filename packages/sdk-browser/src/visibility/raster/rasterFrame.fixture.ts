import { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { NO_RASTERS } from '../../materials/graph/graphRasters.ts'
import { createGpuRaster, type BinningSteps } from './raster.ts'
import type { GpuRasterInput } from './types.ts'
import { RASTER_PASS_MAIN, RASTER_PASS_POST } from './contract.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { WIDE_ATOMIC_FEATURE } from '../../gpu/core/wideAtomics.ts'

/** The binning's steps, none encoded: what a test of the raster alone leaves to the decode and the
 *  bins (`../passes/binning.ts`). */
const NO_STEPS: BinningSteps = { ready: () => true, clear() {}, decode() {}, bins() {} }

/** A raster over a fake device — with the 64-bit atomic maximum or without it (`wide`) —, whose
 *  passes hold the plane's code or not (`clipping`), and an image that asks the tessellation or not. */
export function rasterOf(tessellating: boolean, clipping = false, wide = false) {
  const f = fakeDevice({
    ...(wide && { features: [WIDE_ATOMIC_FEATURE] }),
    limits: {
      maxStorageBufferBindingSize: 134217728,
      maxBufferSize: 268435456,
      maxComputeWorkgroupsPerDimension: 65535,
    },
  })
  const device = f.device as unknown as GPUDevice
  const raster = createGpuRaster(device, 64, 64, 4096, NO_RASTERS, clipping)
  const buffer = (label: string) =>
    device.createBuffer({ label, size: 4096, usage: 0x80 | 0x40 | 0x8 })
  const input = {
    indices: buffer('indices'),
    positions: buffer('positions'),
    pages: buffer('pages'),
    uniform: buffer('uniform'),
    uvs: buffer('uvs'),
    textures: { data: { views: [{}, {}, {}], pages: { buffer: buffer('data pages') } } },
    sampler: {},
    material: {},
    normals: {},
    frame: buffer('graph frame'),
    noise: {},
    idsView: {},
    classBins: {},
    depthView: {},
    hizView: {},
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
    raster.encodeBinning(encoder, input, RASTER_PASS_MAIN, NO_STEPS)
    const steps = new ComputeRun().begin(encoder)
    raster.encodeDepth(steps, RASTER_PASS_MAIN, input)
    steps.end()
    raster.encodeBinning(encoder, input, RASTER_PASS_POST, NO_STEPS)
    raster.encodeClose(encoder, input, [64, 64], true)
    return f.dispatches.map((d) => d.entryPoint)
  }
  return { f, device, raster, frame, input }
}
