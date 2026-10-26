import type { pooledDeformationRows } from '../../../deformation/pooledRows.ts'
import { hasPage } from '../../rows/page/pageSlots.ts'

import type { PageRec, DeformationOutput } from '../../selection/types.ts'
import type { GeometryBlock } from '../../rows/page/pageRowMaterial.ts'
import type { SessionDeformation } from '../../../deformation/session.ts'

import { createVertexPool, type VertexPool } from './geometryPool.ts'
import type { Geometry } from '../../../../../sdk-core/src/world/geometry/geometry.ts'
type GeometryBlocks = Map<Geometry['attributes'], GeometryBlock>
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
  /** The normal atlas's view (`../../../gpu/core/floatAtlas.ts`). */
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

/** What the packing keeps: the deformation, the blocks placed after the records, and the pool. */
interface Packing {
  device: GPUDevice
  deformation: SessionDeformation | undefined
  grown: ((update: VertexPoolGrowth) => void) | undefined
  geometryBlocks: GeometryBlocks
  pooled: ReturnType<PooledRowsOf>
  pooledDeformation: VertexPoolGrowth['pooledDeformation']
  /** The floats the records had when the blocks were last placed after them. */
  recordFloats: number
  vertexPool: VertexPool
}

/** Places the deformation block after `count` vertices and the result blocks after it: a
 *  growth's table replaces the one placed before it, which is freed. */
const placePooled = (g: Packing, count: number) => {
  g.deformation?.place(count * 3)
  g.recordFloats = g.deformation?.floats ?? 0
  g.pooledDeformation?.table.destroy()
  g.pooledDeformation = g.pooled.upload(
    g.device,
    count * 3 + (g.deformation?.floats ?? 0),
    (attributes) => g.geometryBlocks.get(attributes)!,
  )
}

/** The pool's buffers and the blocks re-placed, the owners told. */
const regrow = (g: Packing, count: number) => {
  placePooled(g, count)
  g.grown?.({
    concatPos: g.vertexPool.concatPos,
    concatUv: g.vertexPool.concatUv,
    concatNrm: g.vertexPool.concatNrm,
    pooledDeformation: g.pooledDeformation,
  })
}

/** Whether the pool holds the float geometries `pages` read, its tail the records and blocks
 *  they need: false where the device refuses the room. */
const extendPool = (
  g: Packing,
  pooledRows: PooledRowsOf,
  blocks: readonly DeformationOutput[],
  pages: readonly PageRec[],
  code: PooledRowsOf = pooledRows,
) => {
  const { deformation, vertexPool } = g
  const next = code(deformation, blocks)
  if (!placeFloatPages(vertexPool, pages)) return false
  const before = g.pooled,
    unmoved =
      next.floats === before.floats &&
      next.rows === before.rows &&
      (deformation?.floats ?? 0) === g.recordFloats
  g.pooled = next
  if (unmoved) return true
  if (!vertexPool.reserve((deformation?.floats ?? 0) + next.floats))
    return ((g.pooled = before), false)
  regrow(g, vertexPool.size)
  return true
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
  const sourced = new Map<Geometry['attributes'], boolean>()
  for (const rec of allPages)
    if (!rec.geometryPage && hasPage(rec)) sourced.set(rec.attributes, !!rec.drawSource?.dynamic)
  const g: Packing = {
    device,
    deformation,
    grown,
    geometryBlocks,
    pooled: pooledRows(deformation, blocks),
    pooledDeformation: undefined,
    recordFloats: 0,
    vertexPool: undefined as unknown as VertexPool,
  }
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
  const vertexPool = (g.vertexPool = createVertexPool(
    device,
    capacity,
    coloured,
    geometryBlocks,
    (deformation?.floats ?? 0) + g.pooled.floats,
    (count) => regrow(g, count),
    secondUv,
  ))
  vertexPool.pack(sourced)
  placePooled(g, capacity)
  const { concatPos, concatUv, concatNrm } = vertexPool
  return {
    concatPos,
    concatUv,
    concatNrm,
    vertexPool,
    pooledDeformation: g.pooledDeformation,
    extendGeometry: (pages: readonly PageRec[], code?: PooledRowsOf) =>
      extendPool(g, pooledRows, blocks, pages, code),
  }
}
