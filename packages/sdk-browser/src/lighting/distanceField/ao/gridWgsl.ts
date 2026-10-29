import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { clampToExtent } from '../../../../../math/src/wgsl/sampling.ts'
import { DFAO_COMMON_WGSL } from './commonWgsl.ts'
import { DFAO_BINDING as B } from './layout.ts'

/** The threads of a group of the clear. */
export const CLEAR_GROUP = 256

/**
 * THE GRID'S CELLS AND THE CONES' VISIBILITIES, as the passes that trace cones read and write them. `dfaoGrid`
 * is the normals and depths grid's cell at a texel (`normals`; the texel held to the grid): the world normal
 * and the scene depth in centimetres. The visibilities are nine floats a cone-grid cell, the bits of each in a word
 * (`atomicMin` keeps the least: a visibility is never negative, so the order of the bits is the order of the
 * numbers), the cone's block the whole grid: the word of cone `c` at cell `base` is `c · cells + base`
 * (`dfaoVisibilityIndex`).
 */
export const DFAO_GRID_WGSL = wgslBlock(
  'DFAO_GRID_WGSL',
  [DFAO_COMMON_WGSL, clampToExtent],
  `@group(0) @binding(${B.normals}) var gridNormals:texture_2d<f32>;
fn dfaoGrid(texel:vec2i)->vec4f{
 return textureLoad(gridNormals,clampToExtent(texel,vec2i(dfao.grid.xy)),0);
}`,
)

/** The visibilities written by atomic minimum, by the tracing passes. */
export const DFAO_VISIBILITY_WRITE_WGSL = wgslBlock(
  'DFAO_VISIBILITY_WRITE_WGSL',
  [DFAO_COMMON_WGSL],
  `@group(0) @binding(${B.visibility}) var<storage,read_write> coneVisibility:array<atomic<u32>>;
fn dfaoKeepVisibility(cone:u32,base:u32,visibility:f32){
 atomicMin(&coneVisibility[dfaoVisibilityIndex(cone,base)],bitcast<u32>(visibility));
}`,
)

/**
 * THE VISIBILITIES SET TO ONE (`dfaoClear`), a thread a word: every cone of every cell starts unoccluded, one being the
 * bits `0x3f800000`.
 */
export const DFAO_CLEAR_WGSL = wgslProgram(
  `@group(0) @binding(${B.visibility}) var<storage,read_write> cleared:array<u32>;
@compute @workgroup_size(${CLEAR_GROUP})
fn dfaoClear(@builtin(global_invocation_id) id:vec3u){
 if(id.x<dfao.cones.x*dfao.cones.y*CONE_DIRECTIONS){cleared[id.x]=0x3f800000u;}
}`,
  [DFAO_COMMON_WGSL],
)
