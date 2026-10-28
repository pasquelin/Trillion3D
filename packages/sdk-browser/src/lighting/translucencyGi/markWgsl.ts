import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { BOUNCE_GRID_STRUCTS_WGSL } from '../bounce/gridWgsl.ts'
import { markPoint } from '../bounce/pool/poolMarkWgsl.ts'
import { SP_REFLECTION } from '../bounce/screen/commonWgsl.ts'
import { GI_VISIBLE_WGSL } from './frameWgsl.ts'
import { TRANSLUCENCY_GI_GROUP } from './layout.ts'

/** Where the mark pass binds what it reads and writes, in group 0 (the depth pyramid and the view are group 1, `SP_REFLECTION`). */
export const MARK_GI_BINDING = { frame: 0, grid: 1, marks: 2 } as const
const b = MARK_GI_BINDING

/**
 * THE MARK OF THE CELLS THE VOLUME READS, a thread a cell of the grid: a cell that is worth tracing (`giVisible`) marks, at its point
 * — the corner of the cell, or the point the image's jitter picks while the cascades are not asked coarser —, the probes of the cube that
 * covers it, in the cascade `translucencyGiRadianceCacheClipmapBias` coarser than the one that does, so that the cells that fill the
 * view take few of the probes the surfaces need (`markPointBiased`, the very bitmap the surfaces' marks fill). The mark is at the cell's own
 * point, not at the one the trace starts from (`giTracePoint` moves it forward off a surface by less than `gi.depth.y` slices): the
 * cascade `bias` coarser spaces its probes over cells wider than that shift, so the cube the shifted point gathers from is the marked cube
 * or one the cells beside it mark.
 */
export const MARK_GI_PROGRAM = wgslProgram(
  `@group(0) @binding(${b.frame}) var<uniform> gi:TranslucencyGiFrame;
@group(0) @binding(${b.grid}) var<uniform> bounce:BounceGrid;
@compute @workgroup_size(${TRANSLUCENCY_GI_GROUP},${TRANSLUCENCY_GI_GROUP},1)
fn markCells(@builtin(global_invocation_id) id:vec3u){
 if(bounce.counts.w==0u||any(id>=gi.grid.xyz)){return;}
 if(!giVisible(id)){return;}
 let bias=u32(gi.temporal.w);
 let offset=select(vec3f(0.0),gi.jitter.xyz,bias==0u);
 markPointBiased(giCellPoint(vec3f(id),offset),0.01,bias);
}`,
  [BOUNCE_GRID_STRUCTS_WGSL, SP_REFLECTION, GI_VISIBLE_WGSL, markPoint(b.marks)],
)
