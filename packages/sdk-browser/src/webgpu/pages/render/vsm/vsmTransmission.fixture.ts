// A transmission under the GPU budget's limit (`encodeVsmRenderAndTransmission`, whose raster
// draws no view here), found short once binned: what the growth tests start from.
import { fakeDevice } from '../../../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuDeviceLedger } from '../../../../gpu/core/deviceLedger.ts'
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
/** An encoder whose passes record nothing. */
const pass = {
  setPipeline() {},
  setBindGroup() {},
  dispatchWorkgroups() {},
  dispatchWorkgroupsIndirect() {},
  end() {},
}
const encoder = {
  beginComputePass: () => pass,
  clearBuffer() {},
  copyBufferToBuffer() {},
} as unknown as GPUCommandEncoder

/** A first transmission binned once, then found short (`wanted`: four times its records), under a
 *  ledger whose limit leaves `room(grown, held)` beside what is held. */
export function shortTransmission(room: (grown: number, held: number) => number) {
  const fake = fakeDevice({
    limits: { maxStorageBufferBindingSize: BINDING, maxTextureDimension2D: 16384 },
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
  const scene = { rowCount: 1, pageLayout: {} } as Parameters<
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
