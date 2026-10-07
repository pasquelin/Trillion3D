import type { wholeDeformationPool } from '../../deformation/wholePool.ts'
import type { BlendGpuItem } from '../blend/state.ts'
import type { HostAttributes } from '../../host/resources.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { GeometryBlock } from '../row/pageRowMaterial.ts'
import type { SessionDeformation } from '../../deformation/session.ts'
import { pooledOutputs } from '../../deformation/slotLayout.ts'
import { createVertexPool } from './geometryPool.ts'
type GeometryBlocks = Map<HostAttributes, GeometryBlock>
type WholeTable = { table: GPUBuffer; count: number } | undefined
/** The whole copies a pool holds after its vertices (`wholeDeformationPool`, deformation's code). */
type WholePool = (...args: Parameters<typeof wholeDeformationPool>) => Pick<
  ReturnType<typeof wholeDeformationPool>,
  'placed' | 'floats' | 'rows'
> & {
  upload: (...args: Parameters<ReturnType<typeof wholeDeformationPool>['upload']>) => WholeTable
}
/** A session that deforms nothing places no whole copy: no float, and nothing to upload. */
const noWholeCopy: WholePool = () => ({ placed: [], floats: 0, rows: 0, upload: () => undefined })
/** What a growth of the pool hands the runtime: the wider buffers and the re-placed block. */
export type VertexPoolGrowth = {
  concatPos: GPUBuffer
  concatUv: GPUBuffer
  /** The normal atlas's view (`floatAtlas.ts`, #1410). */
  concatNrm: GPUTextureView
  wholeDeformation: WholeTable
}

/**
 * Packs, once, the source geometry the passes still read as floats: that of the clusters no
 * quantized page covers, from a cache that carries no geometry page. A cluster drawn from its
 * page contributes no vertex here, and its primitive contributes none unless another of its
 * clusters needs one: that is the whole point of reading a page in place. The float pool it makes
 * (`./geometryPool.ts`) grows its room in place (#1293): `grown` hears each growth with the wider
 * buffers and the deformation block re-placed after them. `wholePool` places the whole copies and
 * the deformation results of the pages drawn from this pool (`pooledOutputs`), the code of a
 * session that deforms.
 */
export function prepareWebgpuGeometry(
  device: GPUDevice,
  allPages: PageRec[],
  geometryBlocks: GeometryBlocks,
  deformation?: SessionDeformation,
  items: readonly BlendGpuItem[] = [],
  grown?: (update: VertexPoolGrowth) => void,
  wholePool: WholePool = noWholeCopy,
) {
  const sourced = new Map<HostAttributes, boolean>()
  for (const rec of allPages)
    if (!rec.geometryPage) sourced.set(rec.attributes, rec.sourceMesh?.geometry.usage === 'dynamic')
  const whole = wholePool(items, deformation, pooledOutputs(allPages))
  for (const item of whole.placed) sourced.set(item.sourceGeometry.attributes, false)
  let vertices = 0,
    room = 0,
    coloured = false,
    secondUv = false
  for (const [attributes, dynamic] of sourced) {
    const n = attributes.position?.count ?? 0
    vertices += n
    if (dynamic) room += n
    coloured ||= !!attributes.color
    secondUv ||= !!attributes.uv1
  }
  const capacity = Math.max(1, vertices + room)
  // The deformation records ride after the positions (#357): the passes read them through the
  // binding they already read the positions through.
  const deformFloats = deformation?.floats ?? 0
  const blockOf = (attributes: HostAttributes) => geometryBlocks.get(attributes)!
  let wholeDeformation: VertexPoolGrowth['wholeDeformation']
  /** Places the deformation block after `count` vertices and points the whole copies at it: a
   *  growth's table replaces the one placed before it, which is freed. */
  const placeWhole = (count: number) => {
    deformation?.place(count * 3)
    wholeDeformation?.table.destroy()
    wholeDeformation = whole.rows
      ? whole.upload(device, vertexPool.concatPos, count * 3 + deformFloats, blockOf)
      : undefined
    for (const item of whole.placed) {
      item.uv = vertexPool.concatUv
      item.normal = vertexPool.normalAtlas
    }
  }
  /** A growth of the pool: the deformation block moves after the wider vertices (#1293). */
  const regrow = (count: number) => {
    placeWhole(count)
    grown?.({
      concatPos: vertexPool.concatPos,
      concatUv: vertexPool.concatUv,
      concatNrm: vertexPool.concatNrm,
      wholeDeformation,
    })
  }
  const vertexPool = createVertexPool(
    device,
    capacity,
    coloured,
    geometryBlocks,
    deformFloats + whole.floats,
    regrow,
    secondUv,
  )
  vertexPool.pack(sourced)
  placeWhole(capacity)
  const { concatPos, concatUv, concatNrm } = vertexPool
  return { concatPos, concatUv, concatNrm, vertexPool, wholeDeformation }
}
