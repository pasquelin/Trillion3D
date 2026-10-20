import { WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { ROW_WORDS, FLAG_DYNAMIC } from '../visibility/types.ts'
import { DEFORM_TAG_WORDS, DEFORM_VERTEX_WORDS, deformOutputWord } from './outputs.ts'
import type { GeometryBlock } from '../webgpu/row/pageRowMaterial.ts'
import type { DeformationOutput } from '../page/selection/types.ts'
import type { HostAttributes } from '../host/resources.ts'
import type { SessionDeformation } from './session.ts'
import { PAGE_INFO } from '../visibility/pageInfo.ts'

/**
 * Setup-only layout of the float-pool blocks of the pages drawn from it (`pooled`,
 * `../deformation/outputs.ts`): rows of the table the stage dispatches after the page rows, one
 * pass of its group each, which deform every vertex of the geometry once for all the pages that
 * read it. Such a row reads no source header — its vertices are the pool's floats — and keeps the
 * owner and image tags of a slot's tail, so a dynamic geometry's last image is its previous one.
 */
export function pooledDeformationRows(
  session: SessionDeformation | undefined,
  pooled: readonly DeformationOutput[] = [],
) {
  let floats = 0,
    rows = 0
  const blocks = pooled.map((block) => {
    const at = floats + DEFORM_TAG_WORDS
    floats += block.count * DEFORM_VERTEX_WORDS
    // A page's own results are deformed by its own row; a float geometry's block by rows of this
    // table.
    if (block.pool) rows += ceilDiv(block.count, WORKGROUP_THREADS)
    return at
  })
  return {
    floats,
    /** Rows of the table: the float-pool blocks' passes. */
    rows,
    upload(
      device: GPUDevice,
      base: number,
      blockOf: (attributes: HostAttributes) => GeometryBlock,
    ) {
      const table = new Uint32Array(rows * ROW_WORDS)
      let row = 0
      pooled.forEach((block, i) => {
        block.from = base + blocks[i]
        if (!block.pool) return
        const { attributes, world } = block.pool,
          geometry = blockOf(attributes),
          deform = world ? (session?.wordOfWorld(world) ?? 0) : 0
        const output = deformOutputWord(block)
        // One pass of the stage's group a row, so the block's vertices spread over the device.
        for (let first = 0; first < block.count; first += WORKGROUP_THREADS, row++) {
          const at = row * ROW_WORDS,
            count = Math.min(WORKGROUP_THREADS, block.count - first)
          table[at + PAGE_INFO.at.flags] = geometry.dynamic ? FLAG_DYNAMIC : 0
          table[at + PAGE_INFO.at.indexCount] = count // any count but zero: the stage skips an empty row
          table[at + PAGE_INFO.at.vertexBase] = geometry.vertexBase + first
          table[at + PAGE_INFO.at.deformCount] = count
          table[at + PAGE_INFO.at.deform] = deform
          table[at + PAGE_INFO.at.deformOutput] = output + first * DEFORM_VERTEX_WORDS
        }
      })
      // Only the blocks of pages' own results: their rows are the page table's.
      if (!rows) return undefined
      const buffer = device.createBuffer({
        label: 'Trillion3D pooled deformation rows',
        size: table.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
      device.queue.writeBuffer(buffer, 0, table)
      return { table: buffer, count: rows }
    },
  }
}
