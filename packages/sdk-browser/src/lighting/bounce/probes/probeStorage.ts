import { arrayView } from '../../../gpu/core/textureViews.ts'
import type { BounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import { constructGpuResources } from '../../../gpu/core/errorScope.ts'
import { createBounceUniform } from '../uniform.ts'
import { markWords } from '../../../../../sdk-core/src/bounce/probeMarks.ts'
import { BOUNCE_ATLAS_FORMAT } from '../atlas.ts'
import { CENSUS_WORDS } from './censusWgsl.ts'

/** Initial probe storage is atomic even when admission refuses the last resource. The probes and
 *  their snapshot are atlases of `extent` (`probeAtlasExtent`): the update writes the one, reads
 *  the other, which then takes the texels written (`BOUNCE_SNAPSHOT_SHADER`) — the table's texels
 *  are written into both (`BOUNCE_TABLE_SHADER`) —, so the two stay equal between updates. Both
 *  start zeroed: no probe, no entry. The frame's queue of probes and the table's queue of records
 *  are storage buffers of `queueBytes` and `recordBytes`; the census, one of its own, and the
 *  bitmap the cells the probes' rays hit are marked in (`hits`: a bit a cell of every level). */
export function createProbeStorage(
  device: GPUDevice,
  cascades: BounceCascades,
  queueBytes: number,
  recordBytes: number,
  extent: [number, number, number],
) {
  return constructGpuResources(device, () => {
    const uniform = createBounceUniform(device, cascades)
    const queue = device.createBuffer({
      label: 'Trillion3D bounce probe queue v1',
      size: queueBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    const records = device.createBuffer({
      label: 'Trillion3D bounce table records v1',
      size: recordBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    /** The census the update adds its counts to, and the census pass counts the field into. */
    const census = device.createBuffer({
      label: 'Trillion3D bounce census v1',
      size: CENSUS_WORDS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    })
    /** The cells the update's rays hit, marked, and read back a few images late (`../hitMarks.ts`). */
    const hits = device.createBuffer({
      label: 'Trillion3D bounce hit marks v1',
      size: markWords(cascades) * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    })
    /** An atlas of `extent`: written as storage, and read. */
    const atlas = (label: string) =>
      device.createTexture({
        label,
        size: extent,
        format: BOUNCE_ATLAS_FORMAT,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      })
    const probes = atlas('Trillion3D bounce probes v4')
    const snapshot = atlas('Trillion3D bounce probes snapshot v4')
    const views = { probes: arrayView(probes), snapshot: arrayView(snapshot) }
    return { uniform, queue, records, census, hits, probes, snapshot, views }
  })
}
