import type { wholeDeformationPool } from '../../deformation/wholePool.ts'
import type { BlendGpuItem } from '../blend/state.ts'
import type { HostAttributes } from '../../host/resources.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { GeometryBlock } from '../row/pageRowMaterial.ts'
import type { SessionDeformation } from '../../deformation/session.ts'
import type { DeformationOutput } from '../../page/selection/types.ts'
import { createVertexPool, type VertexPool } from './geometryPool.ts'
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
  /** The normal atlas's view (`floatAtlas.ts`). */
  concatNrm: GPUTextureView
  wholeDeformation: WholeTable
}

/** The float geometries of the pages that read them placed in the pool's room, which grows in place
 *  for them; false where the device refuses the size or the pool was opened without a list they
 *  carry (colours, a second UV set). A geometry placed already stays. */
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
 * buffers and the deformation block re-placed after them. `wholePool` places the whole copies and
 * the result blocks of the placements (`blocks`), the code of a
 * session that deforms.
 *
 * `extend` is the same layout drawn again for what a source added to the session brings: the
 * float geometries of its pages and of its whole copies placed in the pool's room, the records the
 * session gained and the whole copies and float-pool blocks after them laid out anew
 * (`wholePool`), the tail made wider by doubling when they outgrow it.
 */
export function prepareWebgpuGeometry(
  device: GPUDevice,
  allPages: PageRec[],
  geometryBlocks: GeometryBlocks,
  deformation?: SessionDeformation,
  items: readonly BlendGpuItem[] = [],
  grown?: (update: VertexPoolGrowth) => void,
  wholePool: WholePool = noWholeCopy,
  /** The result blocks the passes write, which lie after the whole copies (`assignDeformationOutputs`); read live. */
  blocks: readonly DeformationOutput[] = [],
) {
  const sourced = new Map<HostAttributes, boolean>()
  for (const rec of allPages)
    if (!rec.geometryPage) sourced.set(rec.attributes, !!rec.drawSource?.dynamic)
  let whole = wholePool(items, deformation, blocks)
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
  // The deformation records ride after the positions: the passes read them through the
  // binding they already read the positions through.
  const blockOf = (attributes: HostAttributes) => geometryBlocks.get(attributes)!
  let wholeDeformation: VertexPoolGrowth['wholeDeformation'],
    /** The floats the records had when the whole copies were last placed after them. */
    recordFloats = 0
  /** Places the deformation block after `count` vertices and points the whole copies at it: a
   *  growth's table replaces the one placed before it, which is freed. */
  const placeWhole = (count: number) => {
    deformation?.place(count * 3)
    recordFloats = deformation?.floats ?? 0
    wholeDeformation?.table.destroy()
    wholeDeformation = whole.upload(
      device,
      vertexPool.concatPos,
      count * 3 + (deformation?.floats ?? 0),
      blockOf,
    )
    for (const item of whole.placed) {
      item.uv = vertexPool.concatUv
      item.normal = vertexPool.normalAtlas
    }
  }
  /** The pool's buffers, the block and the whole copies re-placed, the owners told. */
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
    (deformation?.floats ?? 0) + whole.floats,
    regrow,
    secondUv,
  )
  vertexPool.pack(sourced)
  placeWhole(capacity)
  const { concatPos, concatUv, concatNrm } = vertexPool
  /** Whether the pool holds the float geometries `pages` and the whole copies `held` read, its tail
   *  the records and blocks they need: false where the device refuses the room, or the pool was
   *  opened without a list they carry (colours, a second UV set). */
  const extend = (
    pages: readonly PageRec[],
    held: readonly BlendGpuItem[],
    code: WholePool = wholePool,
  ) => {
    const next = code(held, deformation, blocks)
    if (!placeFloatPages(vertexPool, pages)) return false
    for (const item of next.placed)
      if (!vertexPool.place(item.sourceGeometry.attributes, false)) return false
    const before = whole,
      unmoved =
        next.floats === before.floats &&
        next.rows === before.rows &&
        next.placed.length === before.placed.length &&
        (deformation?.floats ?? 0) === recordFloats
    whole = next
    if (unmoved) return true
    if (!vertexPool.reserve((deformation?.floats ?? 0) + next.floats))
      return ((whole = before), false)
    regrow(vertexPool.size)
    return true
  }
  return { concatPos, concatUv, concatNrm, vertexPool, wholeDeformation, extendGeometry: extend }
}
