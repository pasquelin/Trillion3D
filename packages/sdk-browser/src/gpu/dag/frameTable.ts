import type { RecordLayout } from '../core/recordTexture.ts'
import { recordTextureWgsl, type RecordBinding } from '../core/recordTextureWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FRAME_ROW_WORDS } from './types.ts'

/**
 * THE PLACEMENTS' FRAME WORDS, one home whatever the world's size: a record table
 * (`../core/recordTexture.ts`) of `r32uint` words, a placement a record of one field — `Row`, its
 * row as the host lays it (`worlds.ts`, `primitiveFrameWords`): the stretch, the root, the record
 * shift, the mark, the first page, the open counts it holds, the page count. Every reader reads it
 * in place — the cut's kernels (`shader/levelWgsl.ts`), the tree's leaves and refit
 * (`../../placement/treeLeavesWgsl.ts`, `treeRefitWgsl.ts`) —, written by the host
 * (`cameraFrames.ts`) and by the root boxes pass, the stretch alone, through a write-only storage
 * binding (`../../placement/rootBoxesWgsl.ts`). Copied by none.
 *
 * A row holds 1024 placements, 8192 words; a layer 8192 rows, 2²³ placements; 256 layers 2³¹.
 */
export const FRAME_TABLE: RecordLayout = {
  label: 'Trillion3D DAG frames',
  format: 'r32uint',
  fields: { Row: FRAME_ROW_WORDS },
  rowShift: 10,
  layerShift: 13,
}

/** The frame words as a program binds them, named `name`: `<name>Word(w,k)`, word `k` of
 *  placement `w`'s row where it reads them, `<name>SetWord(w,k,v)` where it writes them. */
export function frameTableWgsl(name: string, binding: Omit<RecordBinding, 'name'>) {
  const read = binding.access !== 'write',
    written = binding.access !== 'read'
  return wgslBlock(
    `frameTable(${name}, ${binding.group}, ${binding.binding}, ${binding.access})`,
    [recordTextureWgsl(FRAME_TABLE, { name, ...binding })],
    `${read ? `fn ${name}Word(w:u32,k:u32)->u32{return ${name}Row(w,k).x;}` : ''}
${written ? `fn ${name}SetWord(w:u32,k:u32,v:u32){${name}RowStore(w,k,vec4u(v,0u,0u,0u));}` : ''}`,
  )
}
