import { nextPow2, workgroupCount } from '../../../../math/src/scalar/integers.ts'
import type { MaterialRecords } from './materialState.ts'
import { pendingMade } from '../../gpu/core/tableGrowth.ts'
import {
  MATERIAL_RECORD_TEXELS,
  MATERIAL_ROW_RECORDS,
  MATERIAL_ROW_TEXELS,
} from './materialLayout.ts'

/** Bytes of a row of the table texture. */
const ROW_BYTES = MATERIAL_ROW_TEXELS * 16

type Table = { view: GPUTextureView | undefined }

/** The table's texture made or grown to hold every record, and the records written since the last
 *  upload sent up: their span of the first row alone, else their rows. */
export function uploadMaterials(p: MaterialRecords, table: Table, device: GPUDevice) {
  const rows = workgroupCount(p.held, MATERIAL_ROW_RECORDS)
  if (!p.texture || p.texture.height < rows) grow(p, table, device, nextPow2(rows))
  const { from: low, to: high } = p.written
  if (low > high) return table.view!
  const first = Math.floor(low / MATERIAL_ROW_RECORDS),
    last = Math.floor(high / MATERIAL_ROW_RECORDS)
  // Within one row, the records' own texels; across rows, those rows whole.
  const x = first === last ? (low % MATERIAL_ROW_RECORDS) * MATERIAL_RECORD_TEXELS : 0,
    width = first === last ? (high - low + 1) * MATERIAL_RECORD_TEXELS : MATERIAL_ROW_TEXELS
  device.queue.writeTexture(
    // Made above when it was not, or too short.
    { texture: p.texture!, origin: [x, first] },
    p.ints,
    { offset: first * ROW_BYTES + x * 16, bytesPerRow: ROW_BYTES },
    [width, last - first + 1],
  )
  p.written.from = Infinity
  p.written.to = -1
  return table.view!
}

/**
 * The table grown to `rows` rows by the growth transaction (`../../gpu/core/tableGrowth.ts`): the
 * new texture made first — refused, the old one stays in place, its records still to send —, then
 * put in place with every record to send again. A pass this image encoded earlier — the opaque
 * resolve before the blends grew the table — still binds the old texture, its command buffer not
 * yet submitted: it is retired, destroyed after the frame's submit (`frameRetire.ts`).
 */
function grow(p: MaterialRecords, table: Table, device: GPUDevice, rows: number) {
  const next = device.createTexture({
    label: 'Trillion3D material records',
    size: [MATERIAL_ROW_TEXELS, rows],
    format: 'rgba32uint',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  pendingMade(device, [next], rows * ROW_BYTES, () => {
    const old = p.texture
    p.texture = next
    table.view = next.createView()
    if (p.held) [p.written.from, p.written.to] = [0, p.held - 1]
    return [old]
  }).commit()
}
