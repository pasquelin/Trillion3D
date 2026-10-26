import { arrayView } from '../../../gpu/core/textureViews.ts'
import type { BounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import { constructGpuResources } from '../../../gpu/core/deviceLedger.ts'
import { createBounceUniform } from '../uniform.ts'
import { BOUNCE_ATLAS_FORMAT } from '../atlas.ts'

/** Initial probe storage is atomic even when admission refuses the last resource: the levels' uniform, the frame's queue of probes
 *  the pool writes (a storage buffer of `queueBytes`) and the cell table (`atlas.ts`, of `extent`), written as storage by the pool and
 *  read by the passes that look for the probe of a cell. The table starts zeroed: no entry names a probe. */
export function createProbeStorage(
  device: GPUDevice,
  cascades: BounceCascades,
  queueBytes: number,
  extent: [number, number, number],
) {
  return constructGpuResources(device, () => {
    const uniform = createBounceUniform(device, cascades)
    const queue = device.createBuffer({
      label: 'Trillion3D bounce probe queue v1',
      size: queueBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    const table = device.createTexture({
      label: 'Trillion3D bounce cell table v1',
      size: extent,
      format: BOUNCE_ATLAS_FORMAT,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
    return { uniform, queue, table, view: arrayView(table) }
  })
}
