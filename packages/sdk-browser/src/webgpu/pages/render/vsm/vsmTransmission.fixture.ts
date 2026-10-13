// A transmission under the GPU budget's limit (`encodeVsmRenderAndTransmission`, whose raster
// draws no view here), found short once binned: what the growth tests start from.
import { fakeDevice } from '../../../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuDeviceLedger } from '../../../../gpu/core/deviceLedger.ts'
import { shadowPageEntries } from '../../../shadow/pageGroup.ts'
import { createVsmResources } from '../../../../vsm/resources.ts'
import { createVsmTransmission } from '../../../../vsm/transmissionPass.ts'
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import type { EngineVsm } from './engineVsm.ts'
import { encodeVsmRenderAndTransmission } from './vsmTransmission.ts'
import {
  vsmTransmissionBytes,
  vsmTransmissionFirstCaps,
  type VsmTransmissionCaps,
} from '../../../../vsm/transmissionLayout.ts'

const BINDING = 1 << 27
/** A first transmission binned once, then found short (`wanted`: four times its records), under a
 *  ledger whose limit leaves `room(grown, held)` beside what is held. */
export function shortTransmission(room: (grown: number, held: number) => number) {
  const fake = fakeDevice({
    limits: { maxStorageBufferBindingSize: BINDING, maxTextureDimension2D: 16384 },
  })
  const encoder = fake.device.createCommandEncoder()
  // The shadow page group, made as the engine makes it, before the ledger counts the frame's own.
  const pageLayout = fake.device.createBindGroupLayout({ entries: shadowPageEntries() })
  const pageBuffer = fake.device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM,
  })
  const pageView = fake.device
    .createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING })
    .createView()
  const pageGroup = fake.device.createBindGroup({
    layout: pageLayout,
    entries: shadowPageEntries().map((e) => ({
      binding: e.binding,
      resource: e.buffer
        ? { buffer: pageBuffer }
        : e.sampler
          ? fake.device.createSampler()
          : pageView,
    })),
  })
  const box = { limit: 1e12 }
  const ledger = installGpuDeviceLedger(fake.device, { limit: () => box.limit })
  const res = createVsmResources(fake.device, {
    fullMapCapacity: 127,
    sunMapCapacity: 35,
  })
  const { layout } = res
  const first = vsmTransmissionFirstCaps(layout.poolPages)
  const held = createVsmTransmission(fake.device, layout, first)
  const vsm = { transmission: held, said: new Set() } as unknown as EngineVsm
  const said: unknown[][] = []
  let invalidated = 0
  const run = { frame: 1 }
  const rt = {
    services: { blendCasters: { used: 1 } },
    diag: { engineDiagnostic: (...args: unknown[]) => said.push(args) },
    lights: { changes: { worldChanged: () => invalidated++ } },
    layout: { rows: { blendFirst: 0, casterSlots: 1 } },
    run,
  } as unknown as WebgpuPagesRuntime
  const scene = { rowCount: 1, pageLayout, pageGroup } as Parameters<
    typeof encodeVsmRenderAndTransmission
  >[5]
  const frame = () => {
    encodeVsmRenderAndTransmission(
      rt,
      vsm,
      encoder,
      res,
      { device: fake.device, lights: [] },
      scene,
    )
    return vsm.transmission
  }
  frame()
  const wanted: VsmTransmissionCaps = { ...first, records: 4 * first.records }
  held.wanted = wanted
  box.limit = ledger.bytes + room(vsmTransmissionBytes(layout, wanted), held.bytes)
  return {
    fake,
    box,
    run,
    ledger,
    layout,
    held,
    vsm,
    said,
    frame,
    wanted,
    first,
    invalidated: () => invalidated,
  }
}
