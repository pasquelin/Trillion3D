import type { RecordLayout } from '../../gpu/core/recordLayout.ts'
import { recordTextureWgsl, type RecordBinding } from '../../gpu/core/recordTextureWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FRAME_ROW_WORDS } from './types.ts'
import { MARK_BITS } from '../../visibility/shader/castingMark.ts'

/**
 * THE PLACEMENTS' FRAME WORDS, one home whatever the world's size: a record table
 * (`../../gpu/core/recordTexture.ts`) of `r32uint` words, a placement a record of two fields. `Row`, its
 * row as the host lays it (`worlds/worlds.ts`, `primitiveFrameWords`), the words below — written by the host
 * (`cameraFrames.ts`). `Stretch`, the stretch every cut projects its errors through: the root boxes
 * pass's alone (`../../placement/roots/rootBoxesWgsl.ts`), from the world the GPU holds, through a
 * write-only storage binding, for every placement before the first cut that reads it — a cut adopted
 * derives every root, a root made or appended in place is listed for the pass
 * (`../../placement/roots/rootWorlds.ts`). The host never writes it. Every reader reads it in place — the
 * cut's kernels (`shader/levelWgsl.ts`) —; copied by none.
 *
 * A record is eleven words: a row holds 512 placements, 5632 words, within the widest a guaranteed
 * device addresses; a layer 8192 rows, 2²² placements; 256 layers 2³⁰.
 */
export const FRAME_TABLE: RecordLayout = {
  label: 'Trillion3D DAG frames',
  format: 'r32uint',
  fields: { Row: FRAME_ROW_WORDS, Stretch: 1 },
  rowShift: 9,
  layerShift: 13,
}

/** The words of a placement's `Row`, as `primitiveFrameWords` lays them: the root the descent starts
 *  from, the record shift that leads its pages to their shared records, the never-culled mark, its
 *  first page — what its shared nodes' pages are counted from —, the open counts it holds of its
 *  own (`heldOpen.ts`), its page count and the shift that leads its pages to their cluster records
 *  (`info/clusterInfoLayout.ts`), then
 *  the distances it is drawn at (`DagRoot.drawDistance`): the bits of two floats, the nearest and
 *  the farthest, both 0 for none; then, when it is an instance of an assembly
 *  (`DagRoot.rootParent`), the node of the node table that holds the error and the ball of the
 *  group that replaces its root, in the space of its primitive (`NODE_PARENT`), else `NO_INDEX`. */
export const ROOT_WORD = 0,
  RECORD_SHIFT_WORD = 1,
  MARK_WORD = 2,
  PAGE_BASE_WORD = 3,
  HELD_BY_WORD = 4,
  PAGE_COUNT_WORD = 5,
  INFO_SHIFT_WORD = 6,
  DRAW_NEAR_WORD = 7,
  DRAW_FAR_WORD = 8,
  PARENT_WORD = 9

/** The mark word's bit on a placement that names a draw distance, set where the packing places it
 *  (`pack/packRoots.ts`) and when a row's distances change (`runtime/runtimeOps.ts`): the cut reads
 *  the two distance words only where it is set (`shader/drawDistanceWgsl.ts`). */
export const DRAW_DISTANCE_MARK = MARK_BITS.drawDistance

/** The mark word's bit beside it on a placement that is one instance of an instanced mesh: its
 *  distances are tested at the centre of its bounds, not at the sphere's edge. */
export const DRAW_INSTANCE_MARK = MARK_BITS.drawInstance

/** The mark bits the draw distance owns: every writer of a placement's mark keeps them. */
export const DRAW_MARKS = DRAW_DISTANCE_MARK | DRAW_INSTANCE_MARK

/** The mark bits a placement drawn at `distance` carries, none for every distance. */
export const drawDistanceMarks = (distance: { perInstance: boolean } | undefined) =>
  distance ? DRAW_DISTANCE_MARK | (distance.perInstance ? DRAW_INSTANCE_MARK : 0) : 0

/** The mark word's bit on a placement that is an instance of an assembly, set where the packing
 *  places it (`pack/packRoots.ts`) and when a row's parent changes (`runtime/runtimeOps.ts`): the
 *  cut reads the parent's node only where it is set (`shader/rootParentWgsl.ts`). */
export const ROOT_PARENT_MARK = MARK_BITS.rootParent

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
