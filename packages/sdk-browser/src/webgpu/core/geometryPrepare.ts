import type { pooledDeformationRows } from '../../deformation/pooledRows.ts'
import { hasPage } from '../row/pageSlots.ts'
import type { HostAttributes } from '../../host/resources.ts'
import type { PageRec, DeformationOutput } from '../../page/selection/types.ts'
import type { GeometryBlock } from '../row/pageRowMaterial.ts'
import type { SessionDeformation } from '../../deformation/session.ts'

import { createVertexPool, type VertexPool } from './geometryPool.ts'
type GeometryBlocks = Map<HostAttributes, GeometryBlock>
type PooledRows = { table: GPUBuffer; count: number } | undefined
/** The deformation rows of the float-pool blocks a pool holds after its records
 *  (`pooledDeformationRows`, deformation's code). */
type PooledRowsOf = (...args: Parameters<typeof pooledDeformationRows>) => Pick<
  ReturnType<typeof pooledDeformationRows>,
  'floats' | 'rows'
> & {
  upload: (...args: Parameters<ReturnType<typeof pooledDeformationRows>['upload']>) => PooledRows
}
/** A session that deforms nothing places no block: no float, and nothing to upload. */
const noPooledRows: PooledRowsOf = () => ({ floats: 0, rows: 0, upload: () => undefined })
/** What a growth of the pool hands the runtime: the wider buffers and the re-placed block. */
export type VertexPoolGrowth = {
  concatPos: GPUBuffer
  concatUv: GPUBuffer
  /** The normal atlas's view (`floatAtlas.ts`). */
  concatNrm: GPUTextureView
  pooledDeformation: PooledRows
}

/** The float geometries of the pages that read them placed in the pool's room, which grows in place
 *  for them, its layout widened for the colours or the second UV set they carry; false where the
 *  device refuses the size. A geometry placed already stays. */
export function placeFloatPages(pool: Pick<VertexPool, 'place'>, pages: readonly PageRec[]) {
  return pages.every(
    (page) => page.geometryPage || pool.place(page.attributes, !!page.drawSource?.dynamic),
  )
}

/**
 * Packs, once, the source geometry the passes still read as floats: that of the clusters no
 * quantized page covers, from a cache that carries no geometry page. A cluster drawn from its
 * page contributes no vertex here, and its primitive contributes none unless another of its
 * clusters needs one: that is the whole point of reading a page in place. The float pool it makes
 * (`./geometryPool.ts`) grows its room in place: `grown` hears each growth with the wider
 * buffers and the deformation block re-placed after them. `pooledRows` places the result blocks of
 * the placements (`blocks`), the code of a session that deforms.
 *
 * `extend` is the same layout drawn again for what a source added to the session brings: the
 * float geometries of its pages placed in the pool's room, the records the session gained and the
 * float-pool blocks after them laid out anew (`pooledRows`), the tail made wider by doubling when
 * they outgrow it.
 */
export function prepareWebgpuGeometry(
  device: GPUDevice,
  allPages: PageRec[],
  geometryBlocks: GeometryBlocks,
  deformation?: SessionDeformation,
  grown?: (update: VertexPoolGrowth) => void,
  pooledRows: PooledRowsOf = noPooledRows,
  /** The result blocks the passes write, which lie after the records (`assignDeformationOutputs`);
   *  read live. */
  blocks: readonly DeformationOutput[] = [],
) {
  const sourced = new Map<HostAttributes, boolean>()
  for (const rec of allPages)
    if (!rec.geometryPage && hasPage(rec)) sourced.set(rec.attributes, !!rec.drawSource?.dynamic)
  let pooled = pooledRows(deformation, blocks)
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
  // The deformation records ride after the positions: the passes read them through the
  // binding they already read the positions through.
  const blockOf = (attributes: HostAttributes) => geometryBlocks.get(attributes)!
  let pooledDeformation: VertexPoolGrowth['pooledDeformation'],
    /** The floats the records had when the blocks were last placed after them. */
    recordFloats = 0
  /** Places the deformation block after `count` vertices and the result blocks after it: a
   *  growth's table replaces the one placed before it, which is freed. */
  const placePooled = (count: number) => {
    deformation?.place(count * 3)
    recordFloats = deformation?.floats ?? 0
    pooledDeformation?.table.destroy()
    pooledDeformation = pooled.upload(device, count * 3 + (deformation?.floats ?? 0), blockOf)
  }
  /** The pool's buffers and the blocks re-placed, the owners told. */
  const regrow = (count: number) => {
    placePooled(count)
    grown?.({
      concatPos: vertexPool.concatPos,
      concatUv: vertexPool.concatUv,
      concatNrm: vertexPool.concatNrm,
      pooledDeformation,
    })
  }
  const vertexPool = createVertexPool(
    device,
    capacity,
    coloured,
    geometryBlocks,
    (deformation?.floats ?? 0) + pooled.floats,
    regrow,
    secondUv,
  )
  vertexPool.pack(sourced)
  placePooled(capacity)
  const { concatPos, concatUv, concatNrm } = vertexPool
  /** Whether the pool holds the float geometries `pages` read, its tail the records and blocks
   *  they need: false where the device refuses the room. */
  const extend = (pages: readonly PageRec[], code: PooledRowsOf = pooledRows) => {
    const next = code(deformation, blocks)
    if (!placeFloatPages(vertexPool, pages)) return false
    const before = pooled,
      unmoved =
        next.floats === before.floats &&
        next.rows === before.rows &&
        (deformation?.floats ?? 0) === recordFloats
    pooled = next
    if (unmoved) return true
    if (!vertexPool.reserve((deformation?.floats ?? 0) + next.floats))
      return ((pooled = before), false)
    regrow(vertexPool.size)
    return true
  }
  return { concatPos, concatUv, concatNrm, vertexPool, pooledDeformation, extendGeometry: extend }
}
