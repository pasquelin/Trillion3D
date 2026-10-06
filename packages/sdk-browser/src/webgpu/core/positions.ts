import type { HostAttributes } from '../../host/resources.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { BlendCopy } from '../../cluster/blendCopyContract.ts'
import { loadHostVertices } from '../../scene/meshes.ts'

/** The clusters no geometry page covers, once the host vertices the WebGPU passes read are
 *  loaded — theirs, and a blend copy's that no page carries —: no session fetches them up front. */
export async function loadUnpaged(pages: readonly PageRec[], copies: readonly BlendCopy[]) {
  const unpaged = pages.filter((rec) => !rec.geometryPage)
  const lists = new Set(unpaged.flatMap((rec) => Object.values(rec.attributes)))
  await Promise.all([
    ...Array.from(lists, (list) => list._load()),
    loadHostVertices(copies.filter((copy) => !copy.userData.pageGeometry)),
  ])
  return unpaged
}

/** Uploads shared source positions once for opaque and transparent draws. */
export function ensureWebgpuPositionBuffer(
  device: GPUDevice,
  attributes: HostAttributes,
  buffers: Map<HostAttributes, GPUBuffer>,
  tally: { vertexBytes: number },
) {
  const existing = buffers.get(attributes)
  if (existing) return existing
  const position = attributes.position
  if (!position) return undefined
  const xyz = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    xyz[i * 3] = position.getX(i)
    xyz[i * 3 + 1] = position.getY(i)
    xyz[i * 3 + 2] = position.getZ(i)
  }
  const buffer = device.createBuffer({
    label: 'Trillion3D positions',
    size: xyz.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, xyz.buffer)
  buffers.set(attributes, buffer)
  tally.vertexBytes += buffer.size
  return buffer
}
