import type { RecordLayout } from '../core/recordLayout.ts'
import { recordTextureWgsl, type RecordBinding } from '../core/recordTextureWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FRAME_ROW_WORDS } from './types.ts'

/**
 * THE PLACEMENTS' FRAME WORDS, one home whatever the world's size: a record table
 * (`../core/recordTexture.ts`) of `r32uint` words, a placement a record of two fields. `Row`, its
 * row as the host lays it (`worlds.ts`, `primitiveFrameWords`): the stretch it was made with, the
 * root, the record shift, the mark, the first page, the open counts it holds, the page count —
 * written by the host (`cameraFrames.ts`). `Stretch`, the stretch every cut projects its errors
 * through: the host's once, when the placement is made, then the root boxes pass's alone, from the
 * world the GPU holds, through a write-only storage binding (`../../placement/rootBoxesWgsl.ts`) — a
 * row the host sends again never takes it back. Every reader reads it in place — the cut's kernels
 * (`shader/levelWgsl.ts`), the tree's leaves and refit (`../../placement/treeLeavesWgsl.ts`,
 * `treeRefitWgsl.ts`) —; copied by none.
 *
 * A row holds 512 placements, 4608 words; a layer 8192 rows, 2²² placements; 256 layers 2³⁰.
 */
export const FRAME_TABLE: RecordLayout = {
  label: 'Trillion3D DAG frames',
  format: 'r32uint',
  fields: { Row: FRAME_ROW_WORDS, Stretch: 1 },
  rowShift: 9,
  layerShift: 13,
}

/** The frame words as a program binds them, named `name`: `<name>Word(w,k)`, word `k` of
 *  placement `w`'s row, and `<name>StretchBits(w)`, its stretch, where it reads them;
 *  `<name>SetStretch(w,v)` where it writes the stretch. */
export function frameTableWgsl(name: string, binding: Omit<RecordBinding, 'name'>) {
  const reads = `fn ${name}Word(w:u32,k:u32)->u32{return ${name}Row(w,k).x;}
fn ${name}StretchBits(w:u32)->u32{return ${name}Stretch(w,0u).x;}`,
    writes = `fn ${name}SetStretch(w:u32,v:u32){${name}StretchStore(w,0u,vec4u(v,0u,0u,0u));}`
  return wgslBlock(
    `frameTable(${name}, ${binding.group}, ${binding.binding}, ${binding.access})`,
    [recordTextureWgsl(FRAME_TABLE, { name, ...binding })],
    `${binding.access !== 'write' ? reads : ''}
${binding.access !== 'read' ? writes : ''}`,
  )
}
